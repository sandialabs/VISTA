# Access Group Project Configuration Screenshot Analysis

Date: 2026-07-26

## Scenario

The focused Playwright flow opens **Project Configuration** on its **General** subtab, confirms the initial `qa-team` value, types `inspection-reviewers-west`, and waits beyond the configuration autosave interval. It verifies that typing sends neither a project update nor a configuration save, then submits the dedicated Access Group action and asserts the exact project request:

```json
{
  "meta_group_id": "inspection-reviewers-west"
}
```

The flow confirms the success message and mutable fixture state, reloads the project, and verifies that `inspection-reviewers-west` remains in the Access Group field. No `PUT /api/projects/{project_id}/configuration` request occurs during typing or submission.

## Artifacts

| Artifact | Viewport | Captured state |
| --- | --- | --- |
| `frontend/artifacts/access-group-project-configuration-desktop.png` | 1280 × 900 | Updated value and visible success confirmation |
| `frontend/artifacts/access-group-project-configuration-narrow.png` | 430 × 900 | Updated value after a full page reload |

## End-user visual analysis

### Desktop

- The Access Group card has a clear heading, concise purpose statement, and a visually distinct security-boundary warning before the editable field.
- The full destination value, `inspection-reviewers-west`, is visible without clipping or horizontal scrolling.
- The dedicated **Update Access Group** action is adjacent to the field and visually separate from configuration-save controls.
- The green **Access Group updated.** confirmation is fully rendered with readable foreground/background contrast.
- All card content remains inside its border with consistent spacing and no overlap.

### Narrow

- The same information hierarchy is preserved at 430 pixels wide.
- The security warning wraps cleanly without truncation.
- The input and destination value remain fully visible.
- The update action expands to the available width, creating a clear touch target.
- The card has no horizontal overflow, clipped text, or overlapping controls after the persisted value is reloaded.

## Result

Visual QA found no blocking desktop or narrow-layout regressions. The screenshots support the behavioral assertions that Access Group is editable from Project Configuration, uses a dedicated update action, communicates its security impact, and displays the persisted destination group after reload.
