import numpy as np
from backend.utils.segmentation_integrations import opencv_backend
from pydantic import BaseModel, Field


class FakeOpenCVSegmentationConfig(BaseModel):
    min_mask_area_px: float = Field(default=1.0, ge=0.0)
    min_peak_distance_px: int = Field(default=20, ge=1)
    mean_shift_sp: int = Field(default=21, ge=1)
    mean_shift_sr: int = Field(default=51, ge=1)


class FakeOpenCVMask(BaseModel):
    segmentation: object | None = None
    bbox: list[float]
    area: float
    score: float | None = None
    label: str = "region_1"


class FakeOpenCVOutput(BaseModel):
    backend: str = "opencv"
    mode: str = "watershed"
    masks: list[FakeOpenCVMask]
    metrics: dict = Field(
        default_factory=lambda: {"runtime": "analysis_toolkit.opencv"}
    )
    raw_output: object | None = None

    model_config = {"arbitrary_types_allowed": True}


class FakeOpenCVSegmentation:
    def __init__(
        self,
        *,
        min_mask_area_px=1.0,
        min_peak_distance_px=20,
        mean_shift_sp=21,
        mean_shift_sr=51,
    ):
        self.config = FakeOpenCVSegmentationConfig(
            min_mask_area_px=min_mask_area_px,
            min_peak_distance_px=min_peak_distance_px,
            mean_shift_sp=mean_shift_sp,
            mean_shift_sr=mean_shift_sr,
        )

    @staticmethod
    def from_config(config):
        return FakeOpenCVSegmentation(**config.model_dump())

    def run(self, data):
        return self._run(data)

    def _run(self, data):
        run_mode = "watershed" if data.run_mode == "default" else data.run_mode
        if run_mode != "watershed":
            raise ValueError(f"Unsupported OpenCV segmentation mode: {data.run_mode}")
        array = np.asarray(data.image)
        intensity = np.max(array[..., :3], axis=2) if array.ndim >= 3 else array
        mask = intensity > 0
        visited = np.zeros(mask.shape, dtype=bool)
        masks = []

        for start_y, start_x in zip(*np.where(mask & ~visited), strict=False):
            if visited[start_y, start_x]:
                continue
            stack = [(int(start_y), int(start_x))]
            visited[start_y, start_x] = True
            ys = []
            xs = []
            while stack:
                y, x = stack.pop()
                ys.append(y)
                xs.append(x)
                for next_y, next_x in (
                    (y - 1, x),
                    (y + 1, x),
                    (y, x - 1),
                    (y, x + 1),
                ):
                    if (
                        0 <= next_y < mask.shape[0]
                        and 0 <= next_x < mask.shape[1]
                        and mask[next_y, next_x]
                        and not visited[next_y, next_x]
                    ):
                        visited[next_y, next_x] = True
                        stack.append((next_y, next_x))

            x = float(min(xs))
            y = float(min(ys))
            width = float(max(xs) - min(xs) + 1)
            height = float(max(ys) - min(ys) + 1)
            masks.append(
                FakeOpenCVMask(
                    bbox=[x, y, width, height],
                    area=max(0.0, width - 1.0) * max(0.0, height - 1.0),
                    score=None,
                    label=f"region_{len(masks) + 1}",
                )
            )

        return FakeOpenCVOutput(
            backend="opencv",
            mode=run_mode,
            masks=masks,
        )


ToolkitSegmentationInput = opencv_backend.ToolkitSegmentationInput
NativeOpenCVSegmentation = FakeOpenCVSegmentation
NativeOpenCVSegmentationConfig = FakeOpenCVSegmentationConfig
