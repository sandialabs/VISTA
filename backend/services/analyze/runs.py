"""In-memory Analyze run bookkeeping helpers."""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

import httpx

RemoteStopper = Callable[[str, str], None]

# Process-local registry of Analyze runs started by this worker.
_RUNS: dict[str, dict[str, Any]] = {}
_RUNS_LOCK = threading.RLock()


def analyze_run_record(
    run_id: str,
) -> dict[str, Any] | None:
    """Return a run record from the shared in-memory run store."""
    with _RUNS_LOCK:
        return _RUNS.get(run_id)


def mark_analyze_run(
    run_id: str,
    **updates: Any,
) -> None:
    """Apply status/result updates to an Analyze run record."""
    with _RUNS_LOCK:
        record = _RUNS.setdefault(run_id, {})
        record.update(updates)


def request_remote_job_stop(fastapi_url: str, job_id: str) -> None:
    """Best-effort cancellation for a remote Analyze model-service job."""
    base_url = fastapi_url.rsplit("/", 1)[0] + "/"
    for method, path in (
        ("POST", f"jobs/{job_id}/cancel"),
        ("POST", f"jobs/{job_id}/stop"),
        ("DELETE", f"jobs/{job_id}"),
    ):
        try:
            response = httpx.request(
                method, f"{base_url}{path}", timeout=10.0, trust_env=False
            )
            if response.status_code < 400:
                return
        except Exception:
            continue


def refresh_remote_job_snapshots(record: dict[str, Any]) -> list[dict[str, Any]]:
    """Probe remote job status and return serializable job snapshots."""
    snapshots = []
    remote_jobs = list(record.get("remote_jobs") or [])
    for remote_job in remote_jobs:
        fastapi_url = str(remote_job.get("fastapi_url") or "")
        job_id = str(remote_job.get("job_id") or "")
        snapshot = dict(remote_job)
        if not fastapi_url or not job_id:
            snapshots.append(snapshot)
            continue
        jobs_url = f"{fastapi_url.rsplit('/', 1)[0]}/jobs/{job_id}"
        try:
            response = httpx.get(jobs_url, timeout=5.0, trust_env=False)
            snapshot["status_probe_http_status"] = response.status_code
            if response.status_code < 400:
                payload = response.json()
                snapshot.update(
                    {
                        "remote_status": payload.get("status"),
                        "return_code": payload.get("return_code"),
                        "uploaded_outputs": payload.get("uploaded_outputs")
                        if isinstance(payload.get("uploaded_outputs"), list)
                        else [],
                        "log_count": len(payload.get("logs", []))
                        if isinstance(payload.get("logs"), list)
                        else 0,
                        "log_tail": payload.get("logs", [])[-10:]
                        if isinstance(payload.get("logs"), list)
                        else [],
                    }
                )
        except Exception as exc:
            snapshot["status_probe_error"] = str(exc)
        snapshots.append(snapshot)
    return snapshots


def start_analyze_run(
    run_id: str,
) -> threading.Event:
    """Create or reset an Analyze run record and return its cancel event."""
    cancel_event = threading.Event()
    with _RUNS_LOCK:
        existing = _RUNS.get(run_id)
        if existing:
            existing_event = existing.get("cancel_event")
            if isinstance(existing_event, threading.Event):
                existing.update({"status": "running", "result": None, "error": None})
                return existing_event
        _RUNS[run_id] = {
            "status": "running",
            "cancel_event": cancel_event,
            "remote_jobs": [],
            "result": None,
            "error": None,
        }
    return cancel_event


def register_remote_analyze_job(
    run_id: str,
    fastapi_url: str,
    job_id: str,
    *,
    stop_remote_job: RemoteStopper = request_remote_job_stop,
) -> None:
    """Register a remote job for a run and stop it immediately if already cancelled."""
    should_stop = False
    with _RUNS_LOCK:
        record = _RUNS.get(run_id)
        if not record:
            return
        record.setdefault("remote_jobs", []).append(
            {"fastapi_url": fastapi_url, "job_id": job_id}
        )
        cancel_event = record.get("cancel_event")
        should_stop = bool(cancel_event and cancel_event.is_set())
    if should_stop:
        stop_remote_job(fastapi_url, job_id)


def stop_analyze_run(
    run_id: str,
    *,
    stop_remote_job: RemoteStopper = request_remote_job_stop,
) -> bool:
    """Signal cancellation for a run and all known remote jobs."""
    with _RUNS_LOCK:
        record = _RUNS.get(run_id)
        if not record:
            return False
        cancel_event = record.get("cancel_event")
        if cancel_event:
            cancel_event.set()
        record["status"] = "stopping"
        remote_jobs = list(record.get("remote_jobs") or [])
    for remote_job in remote_jobs:
        fastapi_url = str(remote_job.get("fastapi_url") or "")
        job_id = str(remote_job.get("job_id") or "")
        if fastapi_url and job_id:
            stop_remote_job(fastapi_url, job_id)
    return True
