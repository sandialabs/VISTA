# PT3 segmentation helper: volumetric tools

## Shipped contract

The helper uses one canonical voxel space with dimensions `[x, y, z]`. Volumetric areas are stored as sorted, clipped, non-overlapping x-runs:

```text
[z, y, xStart, xEnd]
```

`xEnd` is exclusive. Segment payload v1 remains the legacy planar format. A segment is written as v2 when it contains canonical volume runs, and an existing empty v2 mask remains v2 when saved.

The X, Y, Z, MPR, and 3D tabs share slice positions and the current segment. Every planar area keeps its own axis, slice, and source dimensions. Brush, eraser, and connected selection remember independent 2D/3D preferences. The 3D brush and eraser use spacing-aware swept spheres; 3D connected selection uses deterministic six-neighbor volume growth and returns a preview before add/subtract is applied. Introducing a volumetric edit promotes prior planar areas into the same voxel mask in operation order, so 2D and 3D erase affect one another.

Server and client-cache connected growth defaults to 50,000 selected voxels, 150,000 examined voxels, and 10,000 output runs. The server rejects requests above 100,000 selected voxels, 300,000 examined voxels, or 20,000 runs and admits at most two active jobs. Materialized TIFF, NPZ, and Inspiro sources are single-flight and bounded to a 128 MiB source, 32 Mi spatial voxels, and 256 MiB decoded array. Swept-sphere rasterization is independently bounded to 250,000 voxels and 50,000 runs. Persistence allows 50,000 canonical runs for the entire segment, so mixed/repeated edits are compacted into one bounded snapshot rather than accumulating per-gesture payloads. A limited result remains visible and explicitly labeled as partial.

Browser-side 3D connected growth runs only after every source slice is present in the local cache; sparse or incomplete browser caches are refused rather than treating missing slices as zero-valued anatomy. Server-backed volume descriptors use the guarded endpoint instead. Slice projections, ML results, the linked 3D crosshair, and the 3D camera all use canonical cache dimensions, with a small least-recently-used projection cache. The 3D surface renderer keeps the complete stored mask while sharing a 50,000-polygon display budget across all segments and caching the resulting geometry across orbit frames. Pending and selected masks receive priority. When an adversarial thin surface exceeds the display budget, the helper explicitly reports that only the preview surface was truncated.

## Research findings

The interaction model follows established volume-segmentation conventions:

- [3D Slicer Segment Editor](https://slicer.readthedocs.io/en/v5.12.0/user_guide/modules/segmenteditor.html) uses a paint sphere that reaches slices above and below the active slice, preview/apply workflows for seeded growth, fill-between-slices, islands, smoothing, margin, and scissors.
- [MITK Segmentation](https://docs.mitk.org/latest/org_mitk_views_segmentation.html) separates slice-based 2D tools from whole-volume 3D tools and presents 3D results as a preview that must be confirmed. Its 3D set includes thresholds, Otsu, GrowCut, picking, and interpolation.
- [ITK ConnectedThreshold](https://docs.itk.org/projects/doxygen/en/stable/classitk_1_1ConnectedThresholdImageFilter.html) formalizes the implemented seed-plus-intensity-range region-growing model and distinguishes face connectivity from fully connected neighborhoods.
- [ITK-SNAP](https://itksnap.org/pmwiki/uploads/Train/RSNA2017-Handout-Exercises.pdf) reinforces linked orthogonal navigation plus a synchronized 3D inspection surface.

## Recommended next tools

1. **3D threshold range** — Preview voxels between lower and upper intensity limits, optionally restricted to the component connected to a seed. This reuses the current preview/apply and sparse-run contracts.
2. **Islands / connected components** — Keep largest, keep selected, remove small islands, and split disconnected components. This is the fastest cleanup win after thresholding or region growth.
3. **Morphology** — Dilate, erode, open, close, and fill holes with a spacing-aware radius. Show the voxel-count delta before apply.
4. **Plane scissors** — Cut or keep one side of a plane positioned in the 3D view. This is especially useful for removing fixture/background material from CT volumes.
5. **Fill between slices / contour interpolation** — Interpolate sparse contours drawn in two or three orthogonal planes, always as a preview before commit.
6. **Grow from seeds / GrowCut** — Support competing positive labels and background seeds, then update the full-volume proposal as seeds are refined.
7. **Prompt-assisted 3D segmentation** — Add positive/negative points, boxes, and scribbles only after model execution, provenance, resource limits, and deterministic fallback behavior are defined.

Threshold, islands, morphology, and plane scissors should come first: they are deterministic, auditable, and fit the existing volume-run engine without introducing a model-serving dependency.

## Implementation milestones

1. **Canonical mask and persistence** — v2 volume-run schema, v1 compatibility, ordered planar-to-volume promotion, and three-axis projection tests.
2. **Helper navigation** — X, Y, Z, MPR, and 3D views with shared crosshair state, keyboard-operable tabs, focus trapping, and preview retention.
3. **2D/3D tool modes** — per-tool switches, spacing-aware spherical brush/eraser, six-neighbor connected growth, cancellable preview, and add/subtract application.
4. **Resource hardening** — bounded client/server growth, sparse-cache refusal, decode admission control, payload compaction, projection LRU, and surfaced truncation states.
5. **End-user verification** — unit and API regression suites, production frontend build, Playwright interaction coverage, and screenshot inspection.

## Acceptance and compatibility notes

- Six-neighbor connectivity is deliberate: diagonal-only contact does not merge regions.
- Preview generation must be cancellable, and stale requests must never replace a newer preview.
- View-only navigation between X, Y, Z, MPR, and 3D must preserve a completed preview until it is applied, canceled, or its owning segment changes.
- 3D brush interpolation must not leave gaps during fast pointer motion.
- Physical voxel spacing must be applied when rasterizing a sphere.
- Every saved v2 mask must project identically into X, Y, and Z and reconstruct only exposed voxel faces in 3D.
- Existing v1 annotations must deserialize, render, edit in 2D, and save without a semantic change.
