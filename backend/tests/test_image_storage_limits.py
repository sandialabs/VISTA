import asyncio

import pytest

from services.images.storage_limits import ProcessWideStorageLimiter


@pytest.mark.asyncio
async def test_process_wide_storage_limiter_rejects_non_positive_capacity():
    with pytest.raises(ValueError, match="capacity must be positive"):
        ProcessWideStorageLimiter(0)


@pytest.mark.asyncio
async def test_process_wide_storage_limiter_bounds_concurrent_slots():
    limiter = ProcessWideStorageLimiter(2)
    active = 0
    max_active = 0

    async def worker():
        nonlocal active, max_active
        async with limiter.slot():
            active += 1
            max_active = max(max_active, active)
            await asyncio.sleep(0.01)
            active -= 1

    try:
        await asyncio.gather(*(worker() for _ in range(5)))
    finally:
        limiter.shutdown()

    assert max_active == 2


@pytest.mark.asyncio
async def test_process_wide_storage_limiter_releases_cancelled_waits():
    limiter = ProcessWideStorageLimiter(1)
    entered = asyncio.Event()
    release = asyncio.Event()

    async def holder():
        async with limiter.slot():
            entered.set()
            await release.wait()

    async def waiter():
        async with limiter.slot():
            return True

    holder_task = asyncio.create_task(holder())
    await entered.wait()
    waiter_task = asyncio.create_task(waiter())
    await asyncio.sleep(0)
    waiter_task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter_task

    release.set()
    await holder_task

    try:
        async with limiter.slot():
            assert True
    finally:
        limiter.shutdown()
