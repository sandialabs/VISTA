"""Filesystem-safe PT3 cache directory helpers."""

from __future__ import annotations

import contextlib
import os
import stat
import tempfile
import uuid
from pathlib import Path

from core.config import settings

REPO_ROOT = Path(__file__).resolve().parents[3]
PT3_CACHE_NAMESPACES = (
    "pt3_volume_stacks",
    "pt3_splat_assets",
    "pt3_real_splat_assets",
)
PT3_SIMPLIFIED_SPLAT_EXTENSIONS = {".json", ".ply", ".splat"}


class PT3CacheUnavailableError(RuntimeError):
    """Raised when neither configured nor temporary PT3 cache is writable."""


def prepare_pt3_cache_root(root: Path) -> Path:
    """Create and verify every namespace used by PT3 fitting jobs."""
    if root.is_symlink():
        raise OSError("PT3 cache root must not be a symbolic link")
    root = root.resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)

    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    directory_flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    root_fd = os.open(root, directory_flags)
    try:
        root_stat = os.fstat(root_fd)
        if not stat.S_ISDIR(root_stat.st_mode) or root_stat.st_uid != os.geteuid():
            raise OSError(
                "PT3 cache root must be a directory owned by the service user"
            )
        os.fchmod(root_fd, 0o700)

        for namespace in PT3_CACHE_NAMESPACES:
            with contextlib.suppress(FileExistsError):
                os.mkdir(namespace, mode=0o700, dir_fd=root_fd)
            namespace_fd = os.open(namespace, directory_flags, dir_fd=root_fd)
            try:
                namespace_stat = os.fstat(namespace_fd)
                if (
                    not stat.S_ISDIR(namespace_stat.st_mode)
                    or namespace_stat.st_uid != os.geteuid()
                ):
                    raise OSError(
                        "PT3 cache namespaces must be directories owned by the "
                        "service user"
                    )
                os.fchmod(namespace_fd, 0o700)

                probe_name = f".pt3-write-probe-{uuid.uuid4().hex}"
                probe_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
                probe_flags |= getattr(os, "O_CLOEXEC", 0) | getattr(
                    os, "O_NOFOLLOW", 0
                )
                probe_fd = os.open(
                    probe_name,
                    probe_flags,
                    0o600,
                    dir_fd=namespace_fd,
                )
                os.close(probe_fd)
                os.unlink(probe_name, dir_fd=namespace_fd)
            finally:
                os.close(namespace_fd)
    finally:
        os.close(root_fd)
    return root


def prepare_pt3_cache_candidate(candidate: Path) -> Path:
    """Resolve one cache candidate without accepting a link at its root."""
    if candidate.is_symlink():
        raise OSError("PT3 cache root must not be a symbolic link")
    return prepare_pt3_cache_root(candidate.resolve())


def pt3_cache_root() -> Path:
    """Return a cache whose concrete PT3 namespaces are all writable."""
    configured = str(settings.CACHE_DIR or "").strip()
    root = Path(configured).expanduser() if configured else REPO_ROOT / ".cache"
    if not root.is_absolute():
        root = REPO_ROOT / root
    try:
        return prepare_pt3_cache_candidate(root)
    except (OSError, RuntimeError):
        fallback = Path(tempfile.gettempdir()) / f"vista-pt3-cache-{os.getuid()}"
        try:
            return prepare_pt3_cache_candidate(fallback)
        except (OSError, RuntimeError) as fallback_error:
            raise PT3CacheUnavailableError(
                "PT3 fitting cache is unavailable because its job directories "
                "are not writable"
            ) from fallback_error


def pt3_cache_component(value: object) -> str:
    """Return one safe cache path component without accepting traversal."""
    component = str(value).strip()
    separators = {os.sep}
    if os.altsep:
        separators.add(os.altsep)
    if (
        not component
        or component in {".", ".."}
        or "\x00" in component
        or any(separator in component for separator in separators)
    ):
        raise OSError("PT3 cache path contains an invalid component")
    return component


def pt3_cache_directory(
    namespace: str,
    *components: object,
    root: Path | None = None,
    create: bool = False,
    repair_mode: bool = False,
) -> Path:
    """Open a cache descendant one component at a time without following links.

    ``root`` defaults to the configured cache root. The default flags only open
    an existing directory; pass ``create=True, repair_mode=True`` to prepare a
    job directory.
    """
    if root is None:
        root = pt3_cache_root()
    if namespace not in PT3_CACHE_NAMESPACES:
        raise OSError("Unknown PT3 cache namespace")
    safe_components = [pt3_cache_component(value) for value in components]
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    directory_flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    root_fd = os.open(root, directory_flags)
    current_fd: int | None = None
    try:
        current_fd = os.open(namespace, directory_flags, dir_fd=root_fd)
        current_path = root / namespace
        for component in safe_components:
            if create:
                with contextlib.suppress(FileExistsError):
                    os.mkdir(component, mode=0o700, dir_fd=current_fd)
            child_fd = os.open(component, directory_flags, dir_fd=current_fd)
            try:
                child_stat = os.fstat(child_fd)
                if (
                    not stat.S_ISDIR(child_stat.st_mode)
                    or child_stat.st_uid != os.geteuid()
                ):
                    raise OSError(
                        "PT3 cache descendants must be directories "
                        "owned by the service user"
                    )
                if repair_mode:
                    os.fchmod(child_fd, 0o700)
            except Exception:
                os.close(child_fd)
                raise
            os.close(current_fd)
            current_fd = child_fd
            current_path = current_path / component
        return current_path
    finally:
        if current_fd is not None:
            os.close(current_fd)
        os.close(root_fd)
