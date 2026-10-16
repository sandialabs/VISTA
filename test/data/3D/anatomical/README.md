# PT3 synthetic 3D stack

This directory contains a synthetic thoracic axial-style image stack for PT3 MPR testing. The grayscale volume simulates paired lungs, rib arcs, heart soft tissue, sternum, and spine.

Files are ordered by the `Z###` token and form a 24 x 96 x 128 volume. The stack is intentionally small so backend and browser tests can load it quickly while still exercising one-file-per-slice 3D ingestion.
