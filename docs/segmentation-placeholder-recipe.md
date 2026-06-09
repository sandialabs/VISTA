# How to Add a Deployed Segmentation Function

**The short version:** pick one of the four segmentation placeholders in Pipeline Studio, set `Integration Mode` to either `local_import` or `fastapi`, point VISTA at your deployed function, and return a JSON-serializable `SegmentationOutput` with masks, boxes, labels, scores, and metrics.

VISTA already ships the graph block, parameter fields, request model, response model, dispatch code, and output-artifact handoff. Your job is only to supply the model runtime and keep its response inside the shared contract.

## The five-minute recipe

1. **Choose the placeholder block.** Use one of these method IDs:
   - `segmentation.yolo.placeholder`
   - `segmentation.anomalib.placeholder`
   - `segmentation.sam.placeholder`
   - `segmentation.opencv.placeholder`

2. **Choose the deployment style.**
   - Use `local_import` when the segmentation package is installed in the same Python environment as VISTA.
   - Use `fastapi` when the model runs in a separate service or container.

3. **Return the required shape.** Every implementation should return a dictionary, Pydantic model, or JSON body with this shape:

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

4. **Configure the block in Pipeline Studio.** Set these fields on the selected placeholder block:
   - `Integration Mode`: `local_import` or `fastapi`
   - `Local Function Path`: dotted callable path for `local_import`, such as `my_company.segmentation.yolo_backend.run`
   - `FastAPI URL`: endpoint URL for `fastapi`, such as `http://segmenter:9000/segment`
   - `Mode`: a backend-specific mode string, or `default`
   - `Prompts JSON`: SAM prompts or other prompt data
   - `Options JSON`: backend-specific values such as confidence, model name, or `timeout_seconds`

5. **Run one representative image and inspect the output block.** A connected implementation should produce a nonzero `mask_count` when it finds objects, plus measurements, detections when boxes are present, and overlay metadata for the `Recipe / Artifact Output` block.

## Code map: where the recipe comes from

Use these source files as the authoritative references when changing or extending this integration:

| What you are checking | Code location |
| --- | --- |
| Placeholder parameters: `integration_mode`, `function_path`, `fastapi_url`, `mode`, `prompts`, and `options` | `backend/analyze_toolbox/methods.py:4-30`, `SEGMENTATION_PLACEHOLDER_PARAMETERS` |
| The four placeholder method IDs and their manifest entries | `backend/analyze_toolbox/methods.py:119-158`, `TOOLBOX_METHODS` segmentation `MethodSpec` entries |
| UI labels, default values, and editable parameter fields | `frontend/src/components/InspectionWorkbenchPanel.js:78-112` and `frontend/src/components/InspectionWorkbenchPanel.js:211-235`, `SEGMENTATION_ML_METHOD_GROUPS`, `DEFAULT_SEGMENTATION_ML_PARAMETERS`, and `SEGMENTATION_ML_PARAMETER_FIELDS` |
| Request and response models: `SegmentationInput`, `SegmentationMask`, and `SegmentationOutput` | `backend/analyze_toolbox/segmentation.py:65-84` |
| Runtime dispatch for `placeholder`, `local_import`, and `fastapi` | `backend/analyze_toolbox/segmentation.py:104-151`, `SegmentationComponent.run`, `_run_local_import`, and `_run_fastapi` |
| Mapping from placeholder method ID to backend name | `backend/analyze_toolbox/segmentation.py:180-185`, `SEGMENTATION_METHOD_BACKENDS` |
| Graph node and edge shape used by Pipeline Studio workflows | `backend/analyze_toolbox/contracts.py:87-118`, `WorkflowNodeSpec`, `EdgeSpec`, and `WorkflowGraph` |
| Executor handoff from workflow parameters to `SegmentationInput` | `backend/analyze_toolbox/executor.py:847-861`, `_apply_segmentation_component` |
| Conversion of returned masks into labels, detections, measurements, and overlay metadata | `backend/analyze_toolbox/executor.py:877-914`, `_apply_segmentation_component` |
| Output artifact behavior after segmentation | `backend/analyze_toolbox/executor.py:760-781`, `output.versioned_image_artifact` branch |

## Option A: connect a local Python callable

Use this path when the model package is installed in the same container or virtual environment as the VISTA backend.

1. **Install the model dependency in the VISTA runtime environment.** Examples:

   ```bash
   pip install ultralytics
   pip install anomalib
   pip install segment-anything
   pip install opencv-python-headless
   ```

2. **Create an importable callable.** It may accept a `SegmentationInput` model or a plain dictionary. VISTA first calls your function with the Pydantic object; if that raises `TypeError`, VISTA retries with a dictionary.

   ```python
   # my_company/segmentation/yolo_backend.py
   import base64
   import io
   from PIL import Image

   def run(request):
       payload = request.model_dump(mode="python") if hasattr(request, "model_dump") else request
       image = Image.open(io.BytesIO(base64.b64decode(payload["image_data_base64"]))).convert("RGB")

       # Replace this with real inference.
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

3. **Configure Pipeline Studio.**
   - `Integration Mode`: `local_import`
   - `Local Function Path`: `my_company.segmentation.yolo_backend.run`
   - `Options JSON`: for example, `{"confidence": 0.4}`
   - `Prompts JSON`: prompt data when the backend needs it

4. **Verify the run.** If the import path is wrong, VISTA raises the Python import or attribute error. If the function returns masks, VISTA normalizes them into measurements and detections.

## Option B: connect a FastAPI service

Use this path when segmentation should run outside the VISTA backend process, especially for GPU-heavy models or model stacks with conflicting dependencies.

1. **Expose a segmentation endpoint.** The endpoint should accept the same request fields VISTA sends and return the same output shape.

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
       # Decode request.image_data_base64 and run the model here.
       return {
           "backend": request.backend,
           "mode": request.mode,
           "masks": [],
           "metrics": {"runtime": "fastapi", "service": "replace-me"},
       }
   ```

2. **Start the service where its model dependencies are available.**

   ```bash
   uvicorn segmentation_service:app --host 0.0.0.0 --port 9000
   ```

3. **Configure Pipeline Studio.**
   - `Integration Mode`: `fastapi`
   - `FastAPI URL`: `http://<host>:9000/segment`
   - `Options JSON`: include backend options and, for long runs, `{"timeout_seconds": 120}`
   - `Prompts JSON`: prompt data when the backend needs it

4. **Verify connectivity and payloads.** VISTA posts JSON to your URL, enforces the configured timeout, calls `raise_for_status()`, and then normalizes the response JSON.

## Contract details that matter in production

### Request fields

VISTA sends a `SegmentationInput`-shaped payload:

```json
{
  "image_data_base64": "<PNG bytes as base64>",
  "backend": "yolo | anomalib | sam | opencv",
  "mode": "default",
  "prompts": {},
  "options": {},
  "metadata": {
    "method_id": "segmentation.yolo.placeholder",
    "method_name": "YOLO (placeholder)"
  }
}
```

The image arrives as base64 PNG data. The `backend` value is inferred from the placeholder method ID. Top-level block parameters such as `integration_mode`, `function_path`, and `fastapi_url` are copied into `options` before dispatch.

### Response fields

Each mask may include:

- `bbox`: `[x, y, width, height]` in source-image pixels.
- `area`: pixel area or model-reported area.
- `score`: confidence score.
- `label`: stable class or region label.
- `segmentation`: optional polygon, run-length encoding, dense mask reference, or `null`.

Bounding boxes are enough for a basic overlay. If `bbox` is present, VISTA creates a detection record. Every returned mask also creates a measurement record.

## How the pipeline works after the recipe is done

Pipeline Studio stores an analysis workflow as a `WorkflowGraph`: nodes are blocks, edges are connections, and node `parameters` hold the values entered in the inspector. When a user runs a graph, VISTA walks each source-to-output chain and applies each block to the current image state.

For segmentation placeholders, the executor converts the current image into base64 PNG, builds `SegmentationInput`, and calls `SegmentationComponent`. `SegmentationComponent` then does one of three things:

- returns an empty skipped result for `placeholder`,
- imports and calls your Python function for `local_import`, or
- posts the request to your service for `fastapi`.

After the model returns, the executor converts masks into labels, detections, measurements, and overlay metadata. Later blocks, including `Region Properties (placeholder)` and `Recipe / Artifact Output`, receive those normalized values instead of model-specific objects.

## Deployment checklist

- Keep the placeholder label until the real implementation is wired and tested.
- Keep return payloads JSON-serializable; do not return raw tensors.
- Use stable labels and scores if review, export, or downstream reporting depends on them.
- For `local_import`, install dependencies in the same process environment that runs VISTA.
- For `fastapi`, secure the endpoint for the deployment environment and make sure the VISTA container can reach it.
- Test at least one representative image per backend.
- Confirm output artifacts show the expected mask count, measurements, detections, and overlay metadata.
