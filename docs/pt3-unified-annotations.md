# PT3 unified annotations and registration contract

## Current behavior

- Hand measurements and boxes are persisted in `part.metadata.annotations` in source-pixel coordinates. MPR annotations also record `axis` and `slice_index`.
- Segmentation-helper segments are local React state and disappear when the workbench is reloaded.
- Assigned image and volume overlays are records in `part.metadata.source_images` with `overlay: true`; they are rendered separately from the annotation list.
- `part.metadata.pt3_segmentation` is a separate dense voxel-label contract used by ray marching and 3DGS. It is not the storage format for hand-drawn vector segments.
- Compact MPR, tiles, and the segmentation helper map pointer coordinates across the full display panel and use stretched square SVG overlays. Source images use `object-fit: contain`, so rectangular images can be letterboxed. Fullscreen MPR already uses the source aspect and is therefore inconsistent with the compact view.
- Fullscreen annotation editing is click-to-arm/click-to-place. Annotation interiors cannot be dragged to translate geometry.

## Target behavior

All inspection artifacts appear in one annotation list while retaining creation-specific storage:

| Kind | Canonical storage | Rendering |
| --- | --- | --- |
| Measurement or box | `metadata.annotations[]` | Source image/MPR slice; editable geometry |
| VISTA segment | `metadata.annotations[]` with `geometry.segment` | Source-axis MPR slices and registered 3D projection |
| Assigned overlay | `metadata.source_images[]` with `overlay: true` | Image/MPR compositing and the same list/visibility controls |

Global **Show annotations** and each row's **Show/Hide** action must affect compact, fullscreen, and 3D views. Hiding a persisted annotation updates its existing `hidden` field. Hiding an assigned overlay updates the source-image record's `hidden` field.

The five duplicated MPR-toolbar actions (`Run Segmentation`, `Run Measurements`, `Reset 3D`, `Measure`, and `Draw Box`) are removed. Measurement and box creation remain available from the annotation pane; segmentation helpers remain available from the MPR toolbar.

## API and data contracts

Annotations gain a backward-compatible `annotation_kind` discriminator:

```text
annotation | measurement | vista_segment
```

Old annotations without the field are inferred from their geometry. A VISTA segment is one annotation:

```json
{
  "annotation_kind": "vista_segment",
  "defect_class": "Internal pore",
  "modality": "volume",
  "hidden": false,
  "geometry": {
    "segment": {
      "version": 1,
      "axis": "axial",
      "min_slice": 12,
      "max_slice": 28,
      "image_width": 512,
      "image_height": 384,
      "areas": []
    }
  },
  "metadata": {
    "annotation_color": "#22d3ee",
    "annotation_fill_opacity": 0.24
  }
}
```

`axis` is fixed when the segment is created. The inclusive slice range may be edited. Areas retain ordered add/subtract operations and stable source-space geometry; transient display coordinates, decoded pixels, and ML caches are never persisted.

VISTA segment metadata has built-in safety ceilings aligned with the exact renderer: image width/height `65,536`, slice index `1,000,000`, `64` ordered areas, `10,000` points per area and `50,000` points total, and `50,000` mask runs per area and annotation. Additional JSON ceilings are a 4 MiB SVG mask path, 4,096 characters for other text values, 256-character JSON keys, 5 MiB of text in total, nesting depth `12`, and `550,000` values. Mask runs must be finite in-bounds `[y, start, end]` triples (or their documented coordinate-object aliases). A part may store at most `64` VISTA segment annotations. Limit violations return HTTP 422 details naming the rejected field and built-in ceiling.

The source-image PATCH contract gains optional `hidden`. Existing crop metadata remains readable and writable, but PT3 annotation lists and PT3 fullscreen annotation controls do not expose Crop.

## Coordinate and interaction contract

- Persist continuous, unmirrored source-pixel coordinates only.
- Compute one contained-content transform from element bounds, intrinsic dimensions, and display mirrors.
- Reject creation outside letterboxed source content.
- Use actual source-aspect SVG view boxes with `preserveAspectRatio="xMidYMid meet"` and the same mirror transform as the source.
- Source-to-display-to-source round trips must be accurate within `0.01` source pixel.
- Use pointer events and guarded capture/release; missing or stale pointer IDs must never throw.
- Press-drag-release creates lines and boxes.
- Drag line endpoints or box corners to resize. Drag line bodies or box interiors to translate while clamping the complete geometry to source bounds.
- Pointer movement only updates a local preview; one PATCH is sent on release. Cancellation restores the persisted geometry.
- Creation of calibrated measurements is blocked by the existing calibration dialog when calibration is missing. PT3 MPR uses the backing volume image identity.
- Geometry PATCHes merge existing geometry and metadata so axis, slice, color, opacity, and future fields survive edits.

## 3D vector-segment rendering

Vector helper segments remain separate from dense `pt3_segmentation`. Their axis-aligned extrusion is converted from slice-plane coordinates to canonical voxel coordinates:

- axial plane: `(plane_x, plane_y, slice)` -> `(sagittal, coronal, axial)`
- coronal plane: `(plane_x, plane_y, slice)` -> `(sagittal, coronal, reversed axial row)`
- sagittal plane: `(plane_x, plane_y, slice)` -> `(sagittal, coronal, reversed axial row)`

The 3D viewer projects extrusion surfaces with the same metadata, spacing, direction, camera, rotation, zoom, and mirror contract as the volume/3DGS renderers. This provides a registered annotation layer without rewriting dense labels or splat assets. The fullscreen 3D view exposes a Show annotations toggle.

## Migration and compatibility

- No SQL migration is required; annotations and source images are JSON metadata.
- Legacy annotations are inferred on read and gain `annotation_kind` only when edited.
- Existing dense `pt3_segmentation`, crop children, overlay assignments, and measurement geometry remain intact.
- Legacy single-slice helper geometry is interpreted as `min_slice == max_slice`.
- Coordinate normalization scales legacy geometry recorded against different intrinsic dimensions before display.

## Milestone acceptance checks

1. Pure geometry tests cover contain letterboxes, mirrors, round trips, endpoint/corner resize, body translation, bounds clamping, and safe pointer capture.
2. Backend tests cover annotation-kind compatibility, segment range validation, and overlay visibility updates that preserve unrelated metadata.
3. UI tests cover removal of the five MPR actions, segment persistence/list integration, slice-range editing, per-item visibility, PT3 Crop suppression, and calibration gating.
4. MPR tests render rectangular segments, lines, and boxes at matching compact/fullscreen source coordinates, including mirrored axes.
5. 3D tests verify the explicit axial/coronal/sagittal voxel mapping and shared camera projection.
6. Browser QA creates and reloads a segment, checks below/min/inside/max/above slice visibility, drags measurement and box geometry, toggles each annotation kind, and visually compares compact/fullscreen registration.
