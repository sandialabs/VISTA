"""Local segmentation adapter examples for Pipeline Studio placeholders.

Each module exposes a ``run(request)`` callable that can be used as a
``local_import`` function path from VISTA segmentation placeholder blocks.
"""

__all__ = [
    "anomalib_backend",
    "opencv_backend",
    "sam_backend",
    "yolo_backend",
]
