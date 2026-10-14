"""Shared async database transaction boundaries."""

from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession


async def commit_database_transaction(db: AsyncSession) -> None:
    """Finish an in-flight commit even when its caller is cancelled.

    A propagated ``CancelledError`` is annotated with
    ``vista_commit_succeeded`` so callers can distinguish a durable commit
    from one that still requires rollback or external-resource compensation.
    """

    commit_task = asyncio.create_task(db.commit())
    try:
        await asyncio.shield(commit_task)
    except asyncio.CancelledError as cancelled:
        while not commit_task.done():
            try:
                await asyncio.shield(commit_task)
            except asyncio.CancelledError:
                continue
            except BaseException:
                break
        commit_succeeded = False
        if commit_task.done() and not commit_task.cancelled():
            try:
                commit_task.result()
                commit_succeeded = True
            except BaseException:
                pass
        cancelled.vista_commit_succeeded = commit_succeeded
        raise cancelled
