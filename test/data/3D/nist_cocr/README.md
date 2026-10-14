# NIST CoCr PT3 paired volume fixture

This directory contains a spatially aligned raw/segmentation pair cropped from
the `set1sample5` NIST CoCr XCT volume. The raw fixture is deliberately just
under 100 MB so it can exercise PT3 volume loading with realistic data while
remaining small enough for Git.

## Provenance

The fixtures were generated from these source files on the project data disk:

- `/media/me/WD_Red_6TB_5400/data/NIST_CoCr_XCT/set1sample5/set1sample5raw_uint16.npy`
  - source shape: `(749, 1010, 984)` (`Z, Y, X`)
  - source dtype: `uint16`
  - SHA-256: `667d11601ac5c0c37d5b2ee17c1a678846109a94812ebfa85c12e6f26d981db3`
- `/media/me/WD_Red_6TB_5400/data/NIST_CoCr_XCT/set1sample5/set1sample5segmented_uint8.npy`
  - source shape: `(749, 1010, 984)` (`Z, Y, X`)
  - source dtype: `uint8`
  - SHA-256: `33ffd4b8f3bd5c58d52f43a5ab0a32aee96a99dc6138974102d71302cfc54350`

## Crop geometry

Both arrays use exactly the same crop and mask:

- Z bounds: `0:749` (the complete source depth)
- Y bounds: `377:634` (source indices 377 through 633)
- X bounds: `365:622` (source indices 365 through 621)
- crop shape: `(749, 257, 257)` (`Z, Y, X`)
- cylinder axis: Z
- cylinder center in source coordinates: `(Y=505, X=493)`
- cylinder center in cropped coordinates: `(Y=128, X=128)`
- cylinder radius: 128 voxels
- inclusion rule: `(Y - 128)^2 + (X - 128)^2 <= 128^2`

Values inside the cylinder are byte-for-byte equal to the corresponding source
voxels. Values outside the cylinder are zero in both files. Each XY plane has
51,433 included pixels and 14,616 zero-masked pixels.

## Files

| File | Dtype | Array payload | File size | SHA-256 |
| --- | --- | ---: | ---: | --- |
| `set1sample5raw_center_cylinder_uint16.npy` | `uint16` | 98,941,402 bytes | 98,941,530 bytes (94.36 MiB) | `efa3be29ba931d9ad25b2ac0558b5317f099aab1ed4a192459723cc1451d7969` |
| `set1sample5segmented_center_cylinder_uint8.npy` | `uint8` | 49,470,701 bytes | 49,470,829 bytes (47.18 MiB) | `2a89fb248cb2fd42fbf7b53f013c3066a80660e86654c1db2c8af86336a09a50` |

Both files use NumPy `.npy` format, C-order storage, and contain no pickled
objects. Load them with `numpy.load(path, allow_pickle=False)`.
