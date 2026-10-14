import io

from fastapi import UploadFile
from PIL import Image

from services.images.metadata import tiff_dimensionality_metadata


def test_300_slice_tiff_upload_metadata_exposes_300_slices_per_axis():
    frames = [Image.new("L", (300, 300), color=index % 256) for index in range(300)]
    buf = io.BytesIO()
    frames[0].save(buf, format="TIFF", save_all=True, append_images=frames[1:])
    buf.seek(0)

    metadata = tiff_dimensionality_metadata(
        UploadFile(filename="stack_300.tif", file=buf)
    )

    assert metadata["tiff_dimensionality"] == "3d"
    assert metadata["load_mode"] == "volume"
    assert metadata["frame_count"] == 300
    assert metadata["volume_shape"] == {"axial": 300, "coronal": 300, "sagittal": 300}
