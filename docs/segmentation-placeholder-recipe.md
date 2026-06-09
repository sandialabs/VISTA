# Connecting Pipeline Studio Segmentation Placeholders

VISTA exposes four Pipeline Studio segmentation blocks as deployment placeholders:

- `YOLO (placeholder)` / `segmentation.yolo.placeholder`
- `Anomalib (placeholder)` / `segmentation.anomalib.placeholder`
- `SAM (placeholder)` / `segmentation.sam.placeholder`
- `OpenCV (placeholder)` / `segmentation.opencv.placeholder`

Each block is routed through the same abstraction:

`backend.analyze_toolbox.SegmentationComponent` → `SegmentationInput` → your implementation → `SegmentationOutput`

Until a block is connected, execution is skipped and the UI label includes `(placeholder)` as a reminder that the deployed version still needs a real backend.

## Shared request and response contract

Your implementation should accept a `SegmentationInput`-shaped object or JSON payload:

```json
{
  "image_data_base64": "<PNG bytes as base64>",
  "backend": "yolo | anomalib | sam | opencv",
  "mode": "default",
  "prompts": {},
  "options": {}
}
```

Return a `SegmentationOutput`-shaped object or JSON payload:

```json
{
  "backend": "yolo",
  "mode": "default",
  "masks": [
    {
      "segmentation": null,
      "bbox": [10, 20, 120, 80],
      "area": 9600,
      "score": 0.91,
      "label": "part"
    }
  ],
  "metrics": {"model": "your-model-name"},
  "raw_output": null
}
```

`bbox` is normalized by VISTA as `[x, y, width, height]` in source-image pixels. `segmentation` may be a polygon, run-length encoding, dense mask reference, or `null`; VISTA can still create a basic overlay from bounding boxes while your team standardizes mask transport.

## Option A: connect a locally installed Python implementation

1. Install your dependency in the deployed environment. Examples:

   ```bash
   pip install ultralytics
   pip install anomalib
   pip install segment-anything
   pip install opencv-python-headless
   ```

2. Create a callable importable by the VISTA process. The callable can accept either a `SegmentationInput` model or a plain dictionary.

   ```python
   # my_company/segmentation/yolo_backend.py
   import base64
   import io
   from PIL import Image

   def run(request):
       payload = request.model_dump(mode="python") if hasattr(request, "model_dump") else request
       image = Image.open(io.BytesIO(base64.b64decode(payload["image_data_base64"]))).convert("RGB")

       # Replace this with your actual model inference.
       width, height = image.size
       return {
           "backend": payload.get("backend", "yolo"),
           "mode": payload.get("mode", "default"),
           "masks": [
               {
                   "segmentation": None,
                   "bbox": [0.1 * width, 0.1 * height, 0.4 * width, 0.4 * height],
                   "area": 0.16 * width * height,
                   "score": 0.9,
                   "label": "object",
               }
           ],
           "metrics": {"runtime": "local_import", "model": "your-yolo-model"},
       }
   ```

3. In Pipeline Studio, select the appropriate placeholder block and set:

   - `Integration Mode`: `local_import`
   - `Local Function Path`: `my_company.segmentation.yolo_backend.run`
   - `Options JSON`: any backend-specific options, such as `{"confidence": 0.4}`
   - `Prompts JSON`: prompt data for SAM or other promptable models, when needed

4. Run the workflow. VISTA imports the callable, passes the normalized `SegmentationInput`, normalizes the returned masks, and forwards the measurements/detections/overlay metadata to the output block.

## Option B: connect a remote FastAPI implementation

1. Run your segmentation code as a service. A minimal FastAPI implementation looks like this:

   ```python
   # segmentation_service.py
   from fastapi import FastAPI
   from pydantic import BaseModel, Field

   app = FastAPI()

   class SegmentRequest(BaseModel):
       image_data_base64: str
       backend: str
       mode: str = "default"
       prompts: dict = Field(default_factory=dict)
       options: dict = Field(default_factory=dict)
       metadata: dict = Field(default_factory=dict)

   @app.post("/segment")
   def segment(request: SegmentRequest):
       # Decode request.image_data_base64 and run your model here.
       return {
           "backend": request.backend,
           "mode": request.mode,
           "masks": [],
           "metrics": {"runtime": "fastapi", "service": "replace-me"},
       }
   ```

2. Start the service from the environment where your model dependencies are available:

   ```bash
   uvicorn segmentation_service:app --host 0.0.0.0 --port 9000
   ```

3. In Pipeline Studio, select the placeholder block and set:

   - `Integration Mode`: `fastapi`
   - `FastAPI URL`: `http://<host>:9000/segment`
   - `Options JSON`: backend-specific settings. Include `{"timeout_seconds": 120}` for long-running models.
   - `Prompts JSON`: prompt data for SAM or other promptable models, when needed

4. Run the workflow. VISTA posts the same `SegmentationInput` JSON contract to your endpoint and normalizes the returned `SegmentationOutput` JSON.

## Deployment checklist

- Confirm the placeholder label remains visible until the real implementation is wired and tested.
- Keep return payloads JSON-serializable; avoid returning raw tensors directly.
- Use stable labels and scores where downstream review/export depends on them.
- For local imports, ensure the package is installed in the same container/process that runs VISTA.
- For FastAPI, secure the endpoint according to your deployment environment and keep it reachable from the VISTA container.
- Validate with at least one representative image per backend and confirm output artifacts contain the expected mask count, measurements, and overlay metadata.
