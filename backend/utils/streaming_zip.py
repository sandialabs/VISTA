"""Utilities for generating ZIP archives without buffering the full archive."""

from __future__ import annotations

import io
import queue
import threading
import zipfile
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from typing import Union

ZipContent = Union[str, bytes, bytearray, Callable[[], Union[str, bytes, bytearray, None]]]


@dataclass(frozen=True)
class StreamingZipEntry:
    """A ZIP archive member written lazily by :func:`iter_streaming_zip`."""

    arcname: str
    content: ZipContent


class _QueueWriter(io.RawIOBase):
    """File-like object that forwards ZIP bytes into a queue."""

    def __init__(self, output_queue: "queue.Queue[bytes | BaseException | None]") -> None:
        super().__init__()
        self._queue = output_queue
        self._position = 0

    def writable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return False

    def tell(self) -> int:
        return self._position

    def write(self, b: bytes | bytearray | memoryview) -> int:
        chunk = bytes(b)
        self._position += len(chunk)
        if chunk:
            self._queue.put(chunk)
        return len(chunk)

    def flush(self) -> None:
        return None


def _coerce_content(content: ZipContent) -> bytes:
    if callable(content):
        content = content()
    if content is None:
        return b""
    if isinstance(content, str):
        return content.encode("utf-8")
    if isinstance(content, bytearray):
        return bytes(content)
    return content


def iter_streaming_zip(entries: Iterable[StreamingZipEntry]) -> Iterator[bytes]:
    """Yield a ZIP archive as bytes while entries are written in a background thread.

    ``zipfile.ZipFile`` supports unseekable file-like objects by writing data
    descriptors.  A small queue bridges the blocking writer thread to FastAPI's
    streaming response iterator, so callers do not need a full-archive
    ``BytesIO`` buffer.
    """

    output_queue: "queue.Queue[bytes | BaseException | None]" = queue.Queue(maxsize=8)

    def _writer() -> None:
        try:
            queue_writer = _QueueWriter(output_queue)
            with zipfile.ZipFile(queue_writer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
                for entry in entries:
                    archive.writestr(entry.arcname, _coerce_content(entry.content))
        except BaseException as exc:  # propagate failures to the response iterator
            output_queue.put(exc)
        finally:
            output_queue.put(None)

    thread = threading.Thread(target=_writer, name="vista-streaming-zip", daemon=True)
    thread.start()

    while True:
        item = output_queue.get()
        if item is None:
            break
        if isinstance(item, BaseException):
            raise item
        yield item

    thread.join(timeout=1)
