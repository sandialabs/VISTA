"""Process-wide concurrency limiting for S3/MinIO storage operations."""

import asyncio
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import asynccontextmanager

DEFAULT_PROCESS_STORAGE_OPERATION_CONCURRENCY = 6


class ProcessWideStorageLimiter:
    """Async facade over one process-wide semaphore, safe across event loops.

    Semaphore waits use a dedicated single worker. This avoids blocking an
    application event loop and avoids exhausting the default executor with
    waiting tasks while active S3 operations need that executor themselves.
    """

    def __init__(self, capacity: int) -> None:
        """Create the limiter with a fixed concurrent-operation `capacity`."""
        if capacity <= 0:
            raise ValueError("storage operation capacity must be positive")
        self.capacity = capacity
        self._semaphore = threading.BoundedSemaphore(capacity)
        self._wait_executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="vista-storage-limit",
        )

    def _release_cancelled_wait(self, future: Future[bool]) -> None:
        if future.cancelled():
            return
        try:
            acquired = future.result()
        except BaseException:
            return
        if acquired:
            self._semaphore.release()

    @asynccontextmanager
    async def slot(self):
        """Acquire one capacity slot for the duration of the context."""
        wait_future = self._wait_executor.submit(self._semaphore.acquire)
        acquired = False
        try:
            await asyncio.shield(asyncio.wrap_future(wait_future))
            acquired = True
            yield
        except BaseException:
            if not acquired:
                # A cancelled coroutine must not leak the slot once its
                # already-running semaphore wait eventually succeeds.
                wait_future.add_done_callback(self._release_cancelled_wait)
            raise
        finally:
            if acquired:
                self._semaphore.release()

    def shutdown(self) -> None:
        """Release the dedicated waiter thread (used by focused tests)."""
        self._wait_executor.shutdown(wait=True, cancel_futures=True)


PROCESS_STORAGE_LIMITER = ProcessWideStorageLimiter(
    DEFAULT_PROCESS_STORAGE_OPERATION_CONCURRENCY
)


@asynccontextmanager
async def storage_operation_slot():
    """Bound S3 operations across all requests handled by this worker."""
    async with PROCESS_STORAGE_LIMITER.slot():
        yield
