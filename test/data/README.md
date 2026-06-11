# VISTA hierarchy upload fixtures

This directory contains test upload images sourced from the Hugging Face dataset
`Ryukijano/Pothole-detection-Yolov8`, starting with the upstream image whose
filename begins with `0001`.

The files are renamed into the VISTA inspection hierarchy format:

```text
design_number_lot_number_set_number_serial_number_side_modality_overlay.jpg
```

Example:

```text
D1001_LOT01_SET01_SN0001_front_visual_false.jpg
```

When these files are selected in the image uploader, the filename metadata
extractor should auto-apply the delimiter `_` with keys:

```text
design_number, lot_number, set_number, serial_number, side, modality, overlay
```

The upload flow then posts the raw images and creates inspection parts named by
design, lot, set, and serial number. These fixtures do not assign parts to
inspection batches; `batch_number` remains available for filenames that should
create internal VISTA batch groupings.


Additional `*_segmentation_true.txt` files are compact text overlay fixtures loaded by
the PT1 and PT2 Load Test Data flows alongside the existing visual and heatmap
modalities.
