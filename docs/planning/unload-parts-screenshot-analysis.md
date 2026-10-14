# Unload Parts screenshot analysis

## Before confirmation

Generated QA artifact (git-ignored): `frontend/artifacts/unload-parts-before.png`

- The **Unload Parts** subtab is visible and selected under **Project Data**.
- The panel presents a single red **Unload All Parts** action.
- The current inventory is explicit: **3 parts are currently loaded**.
- Supporting copy states that images and batch definitions remain available.

## After confirmed unload

Generated QA artifact (git-ignored): `frontend/artifacts/unload-parts-after.png`

- The same subtab remains selected after the request and authoritative parts reload.
- The count changes to the empty state: **There are no parts to unload**.
- The top-level **Parts Loaded** summary is refreshed from **3** to **0**, matching the panel.
- The destructive button is disabled, preventing a second empty deletion.
- A success alert reports that three parts were unloaded and that images and batches were preserved.

## Network and interaction findings

- Dismissing the native confirmation issued no DELETE request and left the count unchanged.
- Accepting the confirmation issued exactly one bulk `DELETE /api/projects/{project_id}/parts`.
- The successful action reloaded the parts collection and project summary; it did not request either the image list or image pagination endpoint.
