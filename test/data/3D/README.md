# PT3 3D fixture volumes

This directory contains small one-file-per-slice synthetic volumes for PT3 MPR testing.

- `anatomical/` simulates a thoracic stack with lungs, ribs, heart, sternum, and spine cues.
- `geometric/` is the default PT3 load-test-data fixture. It embeds `XY`, `XZ`, and `YZ` letter blocks on the corresponding orthographic planes.
- `nist_cocr/` contains a paired, spatially aligned raw/segmentation cylinder
  cropped from the NIST CoCr XCT `set1sample5` volume. Its raw `.npy` file is
  approximately 100 MB for realistic PT3 volume-and-overlay loading.

The synthetic volumes are intentionally compact so backend and browser tests
can load them quickly. See each fixture directory's README for provenance,
geometry, and integrity hashes.
