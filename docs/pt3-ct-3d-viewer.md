# PT3 local CT 3D viewer

Vista's selectable PT3 3D pane uses one shared patient-space model for ray marching and real 3DGS. The original scalar volume remains authoritative; Gaussian splats are derived visualization assets. The legacy simplified-splat conversion path remains available to existing API assets but is not a selectable MPR view.

```text
medical source
  -> local preprocessing
  -> authoritative scalar volume bundle
  -> GPU-style volume renderer

authoritative scalar volume bundle
  -> direct voxel-domain Gaussian fitting (default)
  -> canonical scalar-aware Gaussian asset

authoritative scalar volume bundle
  -> calibrated/generated views
  -> trusted synthetic-view or hybrid provider
  -> canonical Gaussian asset

canonical Gaussian asset
  -> 3DGS renderer

volume renderer or 3DGS renderer
  -> shared camera, transforms, clipping, and UI
  -> local web viewer
```

## Running locally

```bash
cd frontend
npm install
npm start
```

Open a PT3 inspection workbench and use the 3D view selector to choose **Real 3DGS** or one of the five options nested under **Ray marching**: **Composite**, **MIP**, **X-ray**, **Iso**, and **Window**. The 2D MPR slice panes continue to display the same source 2D slices. Removed legacy `shell` and `splat` workspace values safely normalize to Orientation; `hybrid3d` normalizes to Composite ray marching.

## Geometry and data contract

Viewer metadata is normalized as `dimensions`, `spacing`, `origin`, `direction`, `scalarType`, `scalarRange`, `modality`, `rescaleSlope`, `rescaleIntercept`, and a non-PHI `sourceId`. Index coordinates are transformed to physical patient coordinates by scaling with voxel spacing, applying the 3x3 direction matrix, and then adding origin. This keeps anisotropic spacing and orientation consistent across volume, splat, clipping, and camera rendering.

Server volume arrays use an explicit channel-last contract: scalar NumPy data is `[z, y, x]`, RGB is `[z, y, x, 3]`, and RGBA is `[z, y, x, 4]`. Channel-first and other four-dimensional layouts are rejected rather than guessed. TIFF and image stacks accept single-band scalar pixels plus RGB or RGBA; ambiguous multi-band modes such as LA and CMYK are rejected. Rendered non-`uint8` color slices map integer samples by their dtype range and map finite floating-point samples in `[0, 1]` directly to `[0, 255]`; RGBA alpha is converted independently so it cannot alter RGB contrast.

## Rendering paths

- **Volume** uses the shared CT transfer-function controls, window/level presets (bone, soft tissue, lung), opacity, quality profiles, bounding box, orientation labels, and crop/clipping state. The current implementation is a browser-local renderer scaffold that preserves geometry and UI contracts while avoiding new large dependencies.
- **Simplified 3DGS** is the retained legacy slice-derived asset process, not an MPR selector option. PLY and JSON `.splat` assets are parsed in a Web Worker so existing asset decoding does not block the main UI.
- **Real 3DGS** is separate from the simplified slice-derived process and offers three fitting strategies. **Direct voxel fit** (`voxel_direct`) is the default: VISTA's built-in deterministic fitter works in physical voxel space and needs neither cameras nor an external provider. It groups spatially local, scalar-similar voxels, matches their physical first and second moments, and emits anisotropic covariance/scales, rotations, opacity, and degree-0 spherical harmonics. Scalar voxel values are view independent, so higher-order, view-dependent SH terms have no observable target in this mode. **Synthetic/camera views** (`synthetic_views`) and **Hybrid provider fit** (`hybrid`) require a trusted provider plus at least two calibrated or generated camera views; those provider modes may jointly optimize means, covariance/scales, rotations, opacity, spherical harmonics, and camera poses. In `hybrid`, the provider currently owns both voxel-native initialization and view refinement; the core adapter does not synthesize images or pass it a direct-fit seed. Configure the trusted server import as `PT3_REAL_3DGS_PROVIDER=package.module.function`. Real mode never substitutes a simplified asset.

### Direct-volume reconstruction controls

Choose a reconstruction directly from the **Ray marching** group in the MPR 3D view selector. Fullscreen retains the detailed controls for the active reconstruction. The renderer decodes the browser-ready slice images to normalized 0–1 luminance, so Window and Iso values are preview-luminance thresholds rather than original CT scalar units such as Hounsfield units. This is a visualization control over the decoded preview stack, not scalar-aware CT window/level processing.

- **Composite** preserves the original front-to-back transfer function and is the backward-compatible default. Dense exterior material can occlude internal detail.
- **MIP** keeps the maximum intensity along each ray. It highlights dense inclusions but discards depth and may still favor a dense outer shell.
- **X-ray** averages intensity along each ray so enclosed material contributes to the image. It is a projection, not a depth-resolved surface.
- **Iso** accumulates a narrow band around a selected intensity. Threshold and band width can peel between material interfaces.
- **Window** rejects samples outside a selected center/width band. It is the most direct way to suppress a dense shell and isolate a lower-intensity internal feature.

Composite, Window, and Iso also offer opt-in **Boundary enhancement**. The shader calculates a spacing-aware central-difference gradient; Composite and Window use it to boost boundary opacity/color, while Iso uses it for gradient lighting. The feature is off by default, preserving the existing Composite control defaults without imposing gradient-sampling cost. Corrected near-to-far traversal and premultiplied blending can change pixels from older builds. Gradient sampling costs additional texture reads when enabled, so use the Performance profile for a large stack if interaction slows. Static reconstructions render on input or viewport invalidation instead of continuously resubmitting the same GPU work. The strength slider is intentionally the only exposed gradient control; mode-specific formula and limitation text updates with the reconstruction selector. MIP and X-ray keep a bounded 512-iteration shader loop, but adapt their sampling interval to span the complete ray rather than truncating deep features on a large axis.

All strategies publish canonical `pt3_real_3dgs/v1` JSON with patient-physical `means`, positive physical-unit `scales`, normalized quaternion `rotations` in `[w, x, y, z]` order, `opacities`, and coefficient-major RGB `sh_coefficients`. Gaussian rotations map local principal axes into patient space, so `Sigma = R diag(scales^2) R^T`. Voxel-direct assets additionally identify `optimization_domain` as `voxel_field`, set `camera_model` to `none`, retain scalar values, and report approximation metrics and explicit parameter provenance. Provider-backed modes must declare `coordinate_space: physical`, `camera_model: pinhole`, and `camera_convention: pt3_patient_physical_w2c_wxyz/v1`, then return optimized cameras in that same convention. The backend validates dimensions, finite values, coordinate/camera conventions, mode-specific camera requirements, asset containment, and fit/optimization metadata before publishing the result. Each request uses immutable job-specific inputs and output plus a row-locked job-ID check, so a stale background result cannot overwrite a newer recompute. Superseded outputs are pruned only after a replacement publishes successfully. A failed recompute removes only its own job copies and restores the prior usable asset with `last_recompute_*` diagnostics. The built-in fitter and trusted providers report staged progress; the UI polls and displays 0–99% updates, then reports 100% only after canonical validation succeeds.

Provider cameras are undistorted pinhole views. Their row-major `intrinsics` is the pixel-space `K` matrix. `rotation_quaternion` is `[w, x, y, z]` for the patient-physical-to-camera rotation `R_pc`, and physical-unit `translation` satisfies `x_camera = R_pc x_patient + t`; camera axes are right-handed with +X right, +Y down, and +Z forward. SH view directions are expressed in patient axes from camera center to Gaussian mean. This fixed convention prevents a provider model trained in a normalized or camera-local frame from being silently overlaid on the patient volume.

Real mode presents a fitting-strategy selector and a 1,000–100,000 splat-budget slider (50,000 default). The JSON/reference implementation is intentionally capped at 100,000 splats and 1,000,000 fitted sample voxels until a binary, scalable GPU path replaces it. Large file-backed `.npy` volumes are reduced deterministically to that bounded working set before float64 conversion: every source block contributes its threshold maximum (or its farthest-from-zero value when zero denotes empty), so sparse off-grid signal is not silently skipped. Patient-space bounds are preserved, and the canonical asset records source dimensions, fitted dimensions, reducer, and sampling plan. Compressed `.npz` volumes above that working budget must first be extracted to `.npy`, because bounded random-access sampling cannot occur without inflating the archive member. Adjusting either control does not start work: the user explicitly clicks **Fit voxel splats** for direct mode or **Train 3DGS splats** for provider modes, after which the current stage and estimated percentage are shown. Direct voxel fit is available whenever the PT3 voxel source can be materialized as an image stack, one NumPy volume, or one multi-page TIFF. For `synthetic_views` or `hybrid`, attach at least two calibrated/generated cameras at `part.metadata.pt3_real_3dgs.cameras` (the legacy `pt3_camera_calibrations` and `camera_calibrations` array keys are also read). Every PT3 source—including a directory of image slices—is treated as an authoritative voxel volume: server-inferred source IDs stay fixed, while generated exterior views may use their own unique camera IDs. Exact camera/source ID matches remain backward compatible, but client IDs never override the server-selected source files.

Source downloads are streamed and atomically published under a 2.5 GiB per-file/whole-stack cap. Project-part APIs reject client filesystem paths and materialize only the part's server-owned sources. Simplified assets are content-keyed, written atomically, and capped at 100,000 splats; their two-pass sampler retains only the output budget rather than first allocating one Python object per active voxel. NPY, NPZ, and TIFF metadata is preflighted before decode; the reference path also caps decoded or NPZ-uncompressed data at 2.5 GiB and archives/stacks at 4,096 members, preventing compressed inputs from bypassing the voxel limit before allocation. CPU fitting/conversion jobs share a per-worker admission slot and recheck job ownership after waiting. The direct fitter's worst-case merge candidates use an in-place 48 MiB numeric buffer at the 1,000,000-active-voxel limit, and a superseded job aborts at its next progress boundary.

The browser reference rasterizer reconstructs each complete 3D covariance from scale and quaternion, projects it with the active perspective-camera Jacobian, evaluates Graphdeco-order real spherical harmonics through degree four for the current view direction, depth-sorts the selected Gaussians, and alpha-composites Gaussian falloff. For responsiveness, canonical assets above 6,000 primitives are deterministically sampled for the Canvas preview; sampling reserves a representative for every nonempty visible segment when the budget permits, and the canonical asset itself is not reduced. Missing provider or camera metadata disables only `synthetic_views` and `hybrid`; it does not make the built-in voxel-direct strategy unavailable. The mathematical model and API contract are detailed in [PT3 voxel-native Gaussian fitting](./pt3-voxel-gaussian-fitting.md).

## Segmentation contract

Ray marching, simplified splats, and real splats share `part.metadata.pt3_segmentation`:

```json
{
  "segments": [
    {"id": 1, "label": "Region A", "color": "#ff7a45", "visible": true, "opacity": 0.8}
  ],
  "label_slices": [
    {"slice_index": 0, "labels": [[0, 1], [0, 0]]}
  ]
}
```

Segment IDs are integers from 1 through 255; 0 is reserved for unsegmented background. Labels must be inline as a complete `labels`, `label_volume`, `voxel_labels`, or `label_slices` volume and must exactly match the source depth and slice dimensions. Arbitrary label URLs are intentionally not fetched by the browser or fitting jobs, avoiding inconsistent authorization and server-side request-forgery risk. Simplified and real splat JSON provide a `segment_ids` value for each segmented splat asset. When a simplified export is capped, deterministic proportional sampling reserves at least one representative for every present segment (including unsegmented label 0) whenever the budget permits; an undersized budget keeps the largest segment buckets with stable ties. Direct voxel fitting keeps every label boundary hard: a Gaussian group cannot combine voxels from different segments. Synthetic/hybrid providers must preserve every nonzero source label in their output IDs, may not invent labels, and declare `hard_source_label` or `max_weight_source_label` assignment in result metadata. The shared controls apply segment color, visibility, and opacity consistently; hidden segments are suppressed rather than recolored as background. Datasets without segmentation metadata, including the simple fixture, show no segment controls and render exactly as before.

## Preprocessing and privacy

Backend PT3 splat generation remains local and cache-backed. Do not upload patient data or commit PHI. Local CT source folders, generated bundles, and cached assets should stay in `.cache/` or ignored local data directories. Use synthetic PT3 fixtures for tests when medical data cannot be committed.

## Performance profiles

Performance, Balanced, and Quality profiles adjust render resolution and volume sample-step estimates. The diagnostics overlay reports dimensions, physical size, FPS, and rendered splat count. Browser/GPU limits should be surfaced as user-visible errors instead of silently distorting volume geometry.

## Known limitations

- Server-backed NumPy volumes currently feed the browser 3D renderer at most 12 sampled axial preview slices. Those slices are decoded to normalized luminance independently of the original scalar units. MPR slice navigation still uses the full server volume, but scalar-accurate windowing and fine through-plane interior detail in the fullscreen ray-marched view require a future streamed/bricked scalar 3D texture path.
- A browser must support WebGL2 3D textures large enough for the materialized stack. VISTA reports the volume dimensions and the device's `MAX_3D_TEXTURE_SIZE` when this hardware limit is exceeded; it also enforces and reports a built-in 512 MiB estimated browser-volume budget covering the bounded decoded-image queue, CPU staging buffers, volume texture, and an inline segmentation texture when present. Both checks run after the first preview slice reveals its dimensions and before the remaining stack is fetched or the voxel buffer is allocated. Every later slice must match those dimensions, is copied directly into the preallocated voxel buffer under bounded concurrency, and can then be released. VISTA does not silently resize, truncate, or upload an inconsistent stack.
- Existing baked 3DGS assets do not support arbitrary CT window/level remapping; use scalar-aware exports for that.
- VISTA bundles a deterministic analytic voxel-domain reference fitter, not a global CUDA gradient/EM optimizer. It records closed-form/derived parameter provenance and does not claim to minimize the documented global reconstruction loss. Synthetic-view and hybrid refinement still require a configured trusted provider, and VISTA neither infers camera calibration from the slice stack nor synthesizes provider training views. Hybrid initialization/refinement is currently provider-owned.
- The Canvas reference rasterizer uses full covariance projection and view-dependent SH but deterministically samples at most 6,000 Gaussians per frame. A future binary WebGL/CUDA rasterizer is needed for lossless interactive display of the full 100,000-splat cap.
- Direct DICOM browser import is not added here; use the existing local backend/synthetic fixtures and future preprocessing to produce browser-ready bundles.

## Checks

```bash
cd frontend
npm run build
npm test -- --watchAll=false --runInBand pt3VolumeGeometry.test.js
```
