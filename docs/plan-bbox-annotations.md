# Implementation Plan: User-Drawn Bounding Boxes, Annotation Review, and Collections

Issues: #22, #56

## Phasing Strategy

Issue #22 is a subset of #56. The plan implements #22 first as the foundation, then layers on #56's additional features. Five phases, each independently shippable.

## Phase 1: Bounding Box Class Definitions (Project Level)

Everything else depends on having a class/label taxonomy for spatial annotations. The existing `ImageClass` model is for whole-image classification and remains separate.

**Backend:**
- New model `BBoxClass` in `core/models.py`: id, project_id, name, description, color (hex), created_at, updated_at
- Pydantic schemas in `core/schemas.py`
- CRUD functions in `utils/crud/bbox_classes.py`
- Router `routers/bbox_classes.py` with endpoints:
  - `POST /api/projects/{project_id}/bbox-classes`
  - `GET /api/projects/{project_id}/bbox-classes`
  - `PATCH /api/bbox-classes/{class_id}`
  - `DELETE /api/bbox-classes/{class_id}`
- Alembic migration

**Frontend:**
- `BBoxClassManager.js` component with color picker, mounted in Project.js

**Tests:**
- `test_bbox_classes.py`

## Phase 2: User Annotation Model and API

**Backend:**
- New model `UserAnnotation`: id, image_id, project_id, bbox_class_id, bbox_x_min/y_min/x_max/y_max (Float), image_width, image_height, notes, created_by_user_id, updated_by_user_id, created_at, updated_at
- Pydantic schemas with export variants
- CRUD in `utils/crud/user_annotations.py`
- Router `routers/user_annotations.py`:
  - `POST /api/images/{image_id}/user-annotations`
  - `GET /api/images/{image_id}/user-annotations`
  - `GET /api/projects/{project_id}/user-annotations`
  - `GET /api/projects/{project_id}/user-annotations/export?format=coco|yolo`
  - `PUT /api/user-annotations/{annotation_id}`
  - `DELETE /api/user-annotations/{annotation_id}`
- Alembic migration

**Tests:**
- `test_user_annotations.py`

## Phase 3: Frontend Drawing Tool

**New Components:**
- `AnnotationDrawingTool.js` -- SVG overlay, click-and-drag rectangle drawing
- `UserAnnotationOverlay.js` -- renders user boxes color-coded by class, interactive selection
- `UserAnnotationPanel.js` -- sidebar list of annotations with edit/delete
- `AnnotationToolbar.js` -- draw mode toggle, active class selector

**Modified Components:**
- `ImageDisplay.js` -- add annotation overlays and drawing tool layers
- `ImageView.js` -- annotation state management, API calls, toolbar integration

## Phase 4: Image Collections

**Backend:**
- New models `Collection` and `CollectionImage`
- Router `routers/collections.py`:
  - CRUD for collections
  - Add/remove images
  - Lock/unlock with reason
  - Review-required toggle
- Locking enforcement on write operations
- Alembic migration

**Frontend:**
- `CollectionManager.js`, `CollectionSelector.js`
- Gallery filtering by collection
- Lock/unlock UI

**Tests:**
- `test_collections.py`

## Phase 5: Annotation Review Workflow and Audit Trail

**Backend:**
- New models `AnnotationReview` and `AuditEvent`
- Audit utility `utils/audit.py`
- Routers for annotation reviews and audit log
- Alembic migration

**Frontend:**
- Review controls on annotation overlay
- Review status indicators on boxes
- Collection review progress bar
- Audit log viewer

**Tests:**
- `test_annotation_reviews.py`

## Dependency Graph

```
Phase 1 (BBox Classes)
  |
  v
Phase 2 (User Annotations API)
  |
  v
Phase 3 (Drawing Tool UI)
  |
  Phase 4 (Collections) -- can parallel with Phase 3
  |
  v
Phase 5 (Review + Audit) -- depends on Phase 2 and Phase 4
```
