# Clearing Queued ML Analyses

This utility lets you find and optionally clear ML analyses that are stuck in a given status (typically `queued`) for a specific project.

## Prerequisites

- Backend is running and reachable.
- You have an API key with access to the project.
- `.env` in the repo root is configured with at least:
  - `API_URL` (e.g. `http://localhost:8000`)
  - `API_KEY` (optional; can also be passed on the command line)

## Recommended usage (wrapper script)

From the repo root:

```bash
bash scripts/run_clear_ml_queue.sh <project_id> --dry-run
```

This will:
- List images for the project
- List analyses per image
- Show which analyses *would* be updated
- Not actually change anything

To actually apply changes, add `--confirm` (and usually an API key):

```bash
bash scripts/run_clear_ml_queue.sh <project_id> \
  --api-key "$API_KEY" \
  --status-from queued \
  --status-to canceled \
  --limit 100 \
  --confirm
```

Notes:
- `project_id` is required as the first argument.
- `--status-from` and `--status-to` must be a valid transition:
  - `queued` → `processing` or `canceled`
  - `processing` → `completed`, `failed`, or `canceled`
- Use `--older-than-seconds N` to only touch analyses older than `N` seconds.
- If neither `--dry-run` nor `--confirm` is supplied, the script defaults to **dry-run** for safety.

## Direct Python usage

You can also call the Python script directly (wrapper adds convenience only):

```bash
python scripts/clear_ml_queue.py <project_id> \
  --api-url "${API_URL:-http://localhost:8000}" \
  --api-key "$API_KEY" \
  --status-from queued \
  --status-to canceled \
  --limit 100 \
  --dry-run
```

Replace `--dry-run` with `--confirm` when you are ready to apply the updates.