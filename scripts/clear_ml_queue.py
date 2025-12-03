#!/usr/bin/env python3
"""Clear queued ML analyses for a project.

This script is intended as an operational tool to clean up
stuck or obsolete ML analysis jobs that are still in "queued"
(or other source) status. It uses the regular API-key routes
and the existing /analyses/{id}/status endpoint, not the
/api-ml HMAC pipeline paths.
"""

import os
import sys
import argparse
import uuid
from datetime import datetime, timedelta
from typing import List, Dict, Any

from pathlib import Path

import requests
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clear queued ML analyses for a project",
    )

    parser.add_argument(
        "project_id",
        help="Project UUID whose analyses should be considered",
    )
    parser.add_argument(
        "--api-url",
        default=os.environ.get("API_URL", "http://localhost:8000"),
        help="Base API URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("API_KEY"),
        help="API key for authentication (or set API_KEY env)",
    )
    parser.add_argument(
        "--status-from",
        default="queued",
        help="Source status to clear (default: queued)",
    )
    parser.add_argument(
        "--status-to",
        default="canceled",
        help="Target status (default: canceled)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Maximum number of analyses to update (default: 100)",
    )
    parser.add_argument(
        "--older-than-seconds",
        type=int,
        default=None,
        help="Only touch analyses older than this many seconds",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only print what would be changed; no updates sent",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Actually perform status updates (required to modify)",
    )

    return parser.parse_args()


def build_session(api_key: str | None) -> requests.Session:
    session = requests.Session()
    if api_key:
        session.headers.update({"Authorization": f"Bearer {api_key}"})
    # For dev/testing, allow X-User-Email header when no API key
    elif os.environ.get("DEBUG", "").lower() in {"1", "true", "yes"}:
        session.headers.update({"X-User-Email": os.environ.get("ML_QUEUE_USER_EMAIL", "test@example.com")})
    return session


def get_api_url(api_base: str, path: str) -> str:
    path = path.lstrip("/")
    # Use /api-key prefix when using API key, otherwise /api
    prefix = "api-key" if os.environ.get("API_KEY") else "api"
    return f"{api_base.rstrip('/')}/{prefix}/{path}"


def list_project_images(session: requests.Session, api_base: str, project_id: str, limit: int = 1000) -> List[Dict[str, Any]]:
    images: List[Dict[str, Any]] = []
    skip = 0
    page_size = min(limit, 100)

    while len(images) < limit:
        url = get_api_url(api_base, f"projects/{project_id}/images")
        params = {"skip": skip, "limit": page_size}
        resp = session.get(url, params=params)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        images.extend(batch)
        if len(batch) < page_size:
            break
        skip += page_size

    return images[:limit]


def list_image_analyses(session: requests.Session, api_base: str, image_id: str) -> List[Dict[str, Any]]:
    url = get_api_url(api_base, f"images/{image_id}/analyses")
    resp = session.get(url)
    resp.raise_for_status()
    data = resp.json()
    # API returns {"analyses": [...], "total": N}
    return data.get("analyses", [])


def parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    # Pydantic / FastAPI usually emit ISO 8601 with timezone
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def main() -> int:
    args = parse_args()

    try:
        uuid.UUID(args.project_id)
    except ValueError:
        print("[ml-queue-clear] Error: project_id must be a valid UUID", file=sys.stderr)
        return 1

    api_base = args.api_url
    api_key = args.api_key

    if not api_key and os.environ.get("DEBUG", "").lower() not in {"1", "true", "yes"}:
        print("[ml-queue-clear] Warning: no API key provided; this may fail in non-debug environments", file=sys.stderr)

    # Safety: require explicit confirmation for write operations
    if not args.dry_run and not args.confirm:
        print("[ml-queue-clear] No --confirm provided; running in dry-run mode.")
        args.dry_run = True

    # Validate status transition against known allowed transitions
    status_from = args.status_from.lower()
    status_to = args.status_to.lower()

    valid_transitions = {
        "queued": {"processing", "canceled"},
        "processing": {"completed", "failed", "canceled"},
    }
    allowed = valid_transitions.get(status_from, set())
    if status_to not in allowed:
        print(
            f"[ml-queue-clear] Error: illegal transition {status_from}->{status_to} per backend rules.",
            file=sys.stderr,
        )
        return 1

    older_than_cutoff: datetime | None = None
    if args.older_than_seconds is not None:
        older_than_cutoff = datetime.utcnow() - timedelta(seconds=args.older_than_seconds)

    print("[ml-queue-clear] Configuration:")
    print(f"  Project ID:   {args.project_id}")
    print(f"  API base:     {api_base}")
    print(f"  Status from:  {status_from}")
    print(f"  Status to:    {status_to}")
    print(f"  Limit:        {args.limit}")
    if older_than_cutoff:
        print(f"  Older than:   {older_than_cutoff.isoformat()} (UTC)")
    print(f"  Dry run:      {args.dry_run}")
    print("")

    session = build_session(api_key)

    # Step 1: list project images
    print("[ml-queue-clear] Fetching project images...")
    images = list_project_images(session, api_base, args.project_id, limit=1000)
    print(f"[ml-queue-clear] Found {len(images)} images in project")

    candidates: List[Dict[str, Any]] = []

    # Step 2: collect candidate analyses
    for img in images:
        image_id = img.get("id")
        if not image_id:
            continue
        analyses = list_image_analyses(session, api_base, image_id)
        for a in analyses:
            if len(candidates) >= args.limit:
                break
            if (a.get("status") or "").lower() != status_from:
                continue
            created_at = parse_iso(a.get("created_at"))
            updated_at = parse_iso(a.get("updated_at"))
            reference_ts = updated_at or created_at
            if older_than_cutoff and reference_ts and reference_ts > older_than_cutoff:
                continue
            a["_image_id"] = image_id
            candidates.append(a)
        if len(candidates) >= args.limit:
            break

    print(f"[ml-queue-clear] Candidate analyses to change: {len(candidates)}")
    for a in candidates:
        print(
            f"  - analysis_id={a.get('id')} image_id={a.get('_image_id')} "
            f"status={a.get('status')} created_at={a.get('created_at')} updated_at={a.get('updated_at')}"
        )

    if not candidates:
        print("[ml-queue-clear] Nothing to do.")
        return 0

    if args.dry_run:
        print("[ml-queue-clear] Dry-run complete. No updates sent.")
        return 0

    # Step 3: perform updates
    updated = 0
    failed = 0

    for a in candidates:
        analysis_id = a.get("id")
        url = get_api_url(api_base, f"analyses/{analysis_id}/status")
        payload = {"status": status_to}
        try:
            resp = session.patch(url, json=payload)
            if resp.ok:
                updated += 1
                print(f"[ml-queue-clear] Updated {analysis_id}: {status_from}->{status_to}")
            else:
                failed += 1
                print(
                    f"[ml-queue-clear] Failed to update {analysis_id}: "
                    f"{resp.status_code} {resp.text}",
                    file=sys.stderr,
                )
        except Exception as exc:  # pragma: no cover - operational logging
            failed += 1
            print(
                f"[ml-queue-clear] Exception updating {analysis_id}: {exc}",
                file=sys.stderr,
            )

    print("")
    print(f"[ml-queue-clear] Done. Updated={updated}, Failed={failed}, Total candidates={len(candidates)}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
