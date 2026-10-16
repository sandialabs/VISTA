# Frontend test artifacts

This folder stores runtime-generated artifacts for local/CI test runs.

## Inspection Workbench E2E screenshot

The Playwright suite writes the inspection workbench screenshot to:

- `frontend/artifacts/pr03-workbench.png`

The PNG is intentionally **not committed** (ignored via `.gitignore`) to keep binary files out of PR diffs.

To regenerate locally:

```bash
cd frontend
npm run test:e2e:pr03
```
