# PT3 voxel-native Gaussian fitting

## Decision

PT3 Real 3DGS treats the registered voxel volume as the authoritative source. Its default fitting mode is **direct voxel fit**: approximate the scalar field with anisotropic 3D Gaussian primitives without first rendering camera images. Synthetic-view photometric 3DGS remains an optional compatibility/refinement mode for external providers.

This is a better-posed problem than synthetic-view reconstruction. Conventional 3DGS needs calibrated photographs because it is solving an inverse problem. VISTA already has the complete 3D field, so projecting it into 2D and reconstructing it again discards interior supervision and introduces projection ambiguity. Recent work directly represents structured volumes with learned 3D Gaussians and scalar reconstruction losses, while GaussianPile demonstrates that slice-aware Gaussian optimization preserves internal volume detail without ordinary exterior-camera supervision:

- [3D Gaussian Splatting, SIGGRAPH 2023](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)
- [GaussianPile, CVPR 2026](https://openaccess.thecvf.com/content/CVPR2026/html/Kong_GaussianPile_A_Unified_Sparse_Gaussian_Splatting_Framework_for_Slice-based_Volumetric_CVPR_2026_paper.html)
- [Efficient Compression of Structured and Unstructured Volumes via Learned 3D Gaussian Representation](https://arxiv.org/abs/2607.01164)
- [Discretized Gaussian Representation for Tomographic Reconstruction, ICCV 2025](https://openaccess.thecvf.com/content/ICCV2025/html/Wu_Discretized_Gaussian_Representation_for_Tomographic_Reconstruction_ICCV_2025_paper.html)

## Mathematical model

For voxel centers `x_j`, scalar/density targets `rho_j`, and optional scalar-derived colors `c_j`, fit:

```text
G_k(x)   = exp(-0.5 (x - mu_k)^T Sigma_k^-1 (x - mu_k))
rho^(x)  = sum_k a_k G_k(x)
c^(x)    = sum_k a_k G_k(x) c_k / (rho^(x) + epsilon)
Sigma_k  = R_k diag(s_k^2) R_k^T
```

A production differentiable optimizer should minimize scalar reconstruction error, gradient error, and leakage into empty or differently segmented voxels:

```text
L = sum_j DeltaV [(rho^(x_j) - rho_j)^2
    + lambda_c rho_j ||c^(x_j) - c_j||^2]
    + lambda_gradient ||grad rho^ - grad rho||_1
    + lambda_leak sum_(x in empty) rho^(x)^2
```

The dependency-light reference fitter produces one Gaussian for each spatially local, scalar-similar, segment-consistent voxel group by matching exact first and second moments:

```text
W       = sum_j w_j
mu      = sum_j w_j x_j / W
Sigma   = sum_j w_j (x_j-mu)(x_j-mu)^T / W
          + D diag(h_x^2,h_y^2,h_z^2) D^T / 12
```

`h^2 / 12` includes the finite cuboid footprint of a voxel, and the source direction matrix `D` rotates that footprint into patient-physical coordinates. Eigendecomposition of `Sigma` yields rotation and positive scales. Groups never cross any differing segment label, including the boundary between label 0 and a named segment. High-error or non-ellipsoidal groups are refined by smaller spatial/scalar bins.

This built-in path is an **analytic moment fit**, not a global differentiable minimizer of the loss above. It records parameter provenance explicitly: mean and covariance are closed-form fitted moments, rotation is derived from covariance, and opacity/degree-0 SH are scalar mappings. It does not consume provider-only iteration, densification, or convergence controls, and it does not claim that the rendered Gaussian mixture globally minimizes scalar reconstruction error. A CUDA provider can add sparse local EM or gradient refinement while producing the same canonical asset.

Raw CT/MRI scalar values are not opacity. The fitter retains scalar values and maps a configured nonnegative density target to opacity. Scalar voxel data is view-independent, so direct mode uses degree-0 spherical harmonics; higher SH coefficients have no identifiable target unless a directional radiance/lighting model is added.

## API and provider contract

`PT3RealSplatOptimizationRequest` gains `fit_mode`:

- `voxel_direct` (default): no cameras required; uses the built-in analytic reference fitter and declares that it is not a global reconstruction optimizer.
- `synthetic_views`: external-provider compatibility mode; requires calibrated/generated views and may optimize the photometric 3DGS parameter set.
- `hybrid`: external-provider mode in which the provider owns both voxel-native initialization and refinement against ray-marched exterior, clipped, and slice views. The core adapter supplies the authoritative voxels and fitting contract, but it does not currently synthesize view images or hand the provider a precomputed direct-fit seed.

The request always carries server-inferred source files plus physical `spacing`, `origin`, `direction`, volume shape, scalar range, and segmentation metadata. Client paths and `source_image_ids` never override server-inferred inputs. Provider modes receive the same strictly normalized inline `uint8` label volume as the direct fitter; URL-only, ambiguous, incomplete, or shape-mismatched segmentation is rejected before provider invocation. A directory of slices, one `.npy`/`.npz` volume, or one multi-page TIFF retains its original source semantics during job materialization, using the authoritative stored image filename rather than mutable part metadata to determine the format.

Camera IDs and voxel-source IDs are separate namespaces for every PT3 source format. A directory of axial/slice images is still one authoritative voxel volume, just like an implicit `.npy`, `.npz`, or multi-page TIFF, so the server retains its inferred source IDs while accepting at least two unique IDs for independently generated/calibrated exterior views. Exact camera/source ID matches remain accepted for backward compatibility and are classified as `server_inferred_source_views`; all other valid view sets are classified as `generated_from_voxel_volume`. Neither case permits the client to select or replace source files.

Provider cameras use one fixed, versioned convention. `coordinate_space` is `physical`, so Gaussian means and scales use the patient-space physical units described by the volume geometry. `camera_model` is `pinhole`, with an undistorted row-major 3x3 intrinsic matrix `K` in pixel units. `camera_convention` is `pt3_patient_physical_w2c_wxyz/v1`: `rotation_quaternion` is `[w, x, y, z]` and produces the patient-to-camera rotation `R_pc`; `translation` uses physical units and `x_camera = R_pc x_patient + t`. Camera axes are right-handed with +X image-right, +Y image-down, and +Z forward, so the camera center is `-R_pc^T t`. Optimized cameras use the same convention. Gaussian quaternions instead map Gaussian-local principal axes into patient physical axes, giving `Sigma = R_g diag(s^2) R_g^T`. SH coefficients use Graphdeco degree/m ordering and are evaluated on the patient-frame unit direction from camera center to Gaussian mean.

Materialization streams object-store responses in 64 KiB chunks and enforces a 2.5 GiB limit for both each file and the complete stack; oversized or interrupted downloads never publish a partial input. Project-part conversion rejects client filesystem paths and uses only server-owned part sources. Before decoding, NumPy headers, NPZ central-directory sizes and member counts, and TIFF dimensions/frame counts are checked against the 16,000,000-voxel, 2.5 GiB decoded-data, and 4,096-member limits. NPZ inspection reads only the selected array header, so a highly compressed archive cannot allocate its declared payload before these checks pass. Simplified and Real reference jobs share one per-worker CPU admission slot. Simplified sampling is two-pass and retains at most 100,000 output objects; direct merging stores at most three compact numeric edge records per active voxel (48 MiB at the one-million-active limit) instead of unbounded Python edge tuples. A queued job rechecks ownership before decoding, and a running direct fit stops at its next progress callback when superseded.

Canonical `pt3_real_3dgs/v1` output remains renderer-compatible and contains means, positive scales, normalized rotations in quaternion `[w, x, y, z]` order, opacities, SH arrays, and segment IDs. Voxel-native assets additionally declare `optimization_domain: voxel_field`, scalar values, density mapping, approximation metrics, and `camera_model: none`. Synthetic/hybrid assets must declare `coordinate_space: physical`, `camera_model: pinhole`, `camera_convention: pt3_patient_physical_w2c_wxyz/v1`, and optimized cameras in that same convention; older providers must add these declarations rather than relying on an ambiguous implicit frame.

## Compatibility and UI

- Existing simplified assets remain readable, and saved `splat` mode selections continue to open the Simplified renderer. New conversions use the bounded, segment-aware path described below.
- Existing trusted photographic providers remain available through `synthetic_views`.
- Real 3DGS defaults to voxel-direct fitting; its button is enabled for any materializable PT3 voxel stack and no longer waits for camera metadata.
- The user selects a 1,000–100,000 splat budget (50,000 default) and explicitly starts/restarts fitting. The cap protects the JSON/reference CPU and Canvas path; the bundled fitter also limits a job to 16,000,000 total and 1,000,000 active voxels, directing larger inputs to thresholding, downsampling, or a scalable provider. Status polling displays provider/reference progress.
- Segmentation controls and canonical `segment_ids` remain shared with simplified splats and ray marching. Voxel labels must be inline; arbitrary URL fetching is deliberately unsupported across all three renderers. The provider request's `segmentation_output_contract` lists the required IDs and supported assignment policies. When provider input contains nonzero labels, every source label must occur in the provider's length-matched `segment_ids`; unknown output labels are rejected. Provider metadata must declare either `hard_source_label` (a Gaussian does not combine source labels) or `max_weight_source_label` (a crossing Gaussian is assigned to the label contributing the most source weight), so segment controls remain meaningful.
- Canonical rendering reconstructs full 3D covariance, projects it through the perspective Jacobian, and evaluates view-dependent Graphdeco-order SH. The Canvas reference view deterministically samples at most 6,000 Gaussians per frame while reserving a representative for each nonempty visible segment when feasible.
- Job-specific input copies are deleted on every terminal path. Superseded outputs are pruned only after a replacement publishes successfully. A failed recompute deletes only its own partial input/output and restores the last usable published asset, recording the failed attempt in `last_recompute_*` metadata. After slow source materialization, the request reloads and row-locks the part before installing pending state, so an asset published during that copy becomes the new recompute fallback rather than being lost to a stale ORM object.

## Done criteria

1. Voxel-direct fitting produces a validated canonical anisotropic asset from an image stack, NumPy volume, or multi-page TIFF without cameras or a configured provider.
2. Means and covariance use physical spacing; rotations are normalized and scales are positive.
3. Degree-0 SH/color and opacity derive from the voxel scalar/density mapping, not invented view-dependent appearance.
4. Hard segment IDs never mix within a Gaussian group; unsegmented data remains `null`.
5. `max_splats` is respected, source inputs are server-inferred and job-isolated, progress remains pollable, and stale jobs cannot publish.
6. Synthetic-view mode fails honestly when its external provider/views are unavailable and never substitutes simplified splats.
7. Backend unit/API tests, frontend mode/control tests, production build, and browser E2E verification pass.
