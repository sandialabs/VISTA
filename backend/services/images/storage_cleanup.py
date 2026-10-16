"""Object-storage upload/copy helpers with best-effort cleanup."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from typing import Any

StorageSlotFactory = Callable[[], AbstractAsyncContextManager[None]]
DeleteFile = Callable[[str, str], Any]
UploadFile = Callable[..., Any]
CopyFile = Callable[..., Any]


async def cleanup_objects(
    object_storage_keys: list[str],
    *,
    bucket_name: str,
    delete_file: DeleteFile,
    storage_operation_slot: StorageSlotFactory,
    concurrency: int,
) -> None:
    """Best-effort cleanup for objects uploaded before a database failure."""
    semaphore = asyncio.Semaphore(concurrency)

    async def delete_one(object_storage_key: str) -> None:
        async with semaphore:
            try:
                async with storage_operation_slot():
                    loop = asyncio.get_running_loop()
                    delete_future = loop.run_in_executor(
                        None,
                        delete_file,
                        bucket_name,
                        object_storage_key,
                    )
                    try:
                        result = await asyncio.shield(delete_future)
                    except asyncio.CancelledError as cancelled:
                        while not delete_future.done():
                            try:
                                await asyncio.shield(delete_future)
                            except asyncio.CancelledError:
                                continue
                            except BaseException:
                                break
                        if delete_future.done():
                            try:
                                result = delete_future.result()
                            except BaseException:
                                result = False
                        raise cancelled
                if asyncio.iscoroutine(result):
                    await result
            except asyncio.CancelledError:
                raise
            except Exception:
                # The caller's database or storage error remains primary.
                pass

    cleanup_task = (
        asyncio.ensure_future(
            asyncio.gather(*(delete_one(key) for key in object_storage_keys))
        )
        if object_storage_keys
        else None
    )
    if cleanup_task is None:
        return
    try:
        await asyncio.shield(cleanup_task)
    except asyncio.CancelledError as cancelled:
        while not cleanup_task.done():
            try:
                await asyncio.shield(cleanup_task)
            except asyncio.CancelledError:
                continue
            except BaseException:
                break
        raise cancelled


async def upload_target_with_cleanup(
    *,
    object_storage_key: str,
    file_data: Any,
    length: int,
    content_type: str | None,
    bucket_name: str,
    upload_file: UploadFile,
    delete_file: DeleteFile,
    storage_operation_slot: StorageSlotFactory,
    cleanup_concurrency: int,
) -> bool:
    """Upload one unique target and remove it on every non-success outcome."""
    try:
        async with storage_operation_slot():
            uploaded = await upload_file(
                bucket_name=bucket_name,
                object_name=object_storage_key,
                file_data=file_data,
                length=length,
                content_type=content_type or "application/octet-stream",
            )
    except asyncio.CancelledError:
        await cleanup_objects(
            [object_storage_key],
            bucket_name=bucket_name,
            delete_file=delete_file,
            storage_operation_slot=storage_operation_slot,
            concurrency=cleanup_concurrency,
        )
        raise
    except Exception:
        await cleanup_objects(
            [object_storage_key],
            bucket_name=bucket_name,
            delete_file=delete_file,
            storage_operation_slot=storage_operation_slot,
            concurrency=cleanup_concurrency,
        )
        return False
    if not uploaded:
        await cleanup_objects(
            [object_storage_key],
            bucket_name=bucket_name,
            delete_file=delete_file,
            storage_operation_slot=storage_operation_slot,
            concurrency=cleanup_concurrency,
        )
        return False
    return True


async def copy_target_with_cleanup(
    *,
    source_bucket: str,
    source_key: str,
    source_etag: str,
    object_storage_key: str,
    bucket_name: str,
    copy_file: CopyFile,
    delete_file: DeleteFile,
    storage_operation_slot: StorageSlotFactory,
    cleanup_concurrency: int,
) -> bool:
    """Copy one unique target and remove ambiguous/failed destinations."""
    try:
        async with storage_operation_slot():
            copied = await copy_file(
                source_bucket,
                source_key,
                bucket_name,
                object_storage_key,
                source_etag=source_etag,
            )
    except asyncio.CancelledError:
        await cleanup_objects(
            [object_storage_key],
            bucket_name=bucket_name,
            delete_file=delete_file,
            storage_operation_slot=storage_operation_slot,
            concurrency=cleanup_concurrency,
        )
        raise
    except Exception:
        await cleanup_objects(
            [object_storage_key],
            bucket_name=bucket_name,
            delete_file=delete_file,
            storage_operation_slot=storage_operation_slot,
            concurrency=cleanup_concurrency,
        )
        return False
    if not copied:
        await cleanup_objects(
            [object_storage_key],
            bucket_name=bucket_name,
            delete_file=delete_file,
            storage_operation_slot=storage_operation_slot,
            concurrency=cleanup_concurrency,
        )
        return False
    return True
