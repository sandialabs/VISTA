# Simple Recipe: Replace a Segmentation Placeholder

Use this recipe when a segmentation model is already deployed and you want a VISTA Pipeline Studio segmentation placeholder to call it.

**Default assumption:** your deployed segmentation function is directly callable from Python. Start with the **Import path implementation** below. Use the **FastAPI implementation** only when the model must run in a separate service or container.

## Choose a placeholder

Pick the placeholder block that best matches the model family you are replacing:

- `segmentation.yolo.placeholder`
- `segmentation.anomalib.placeholder`
- `segmentation.sam.placeholder`
- `segmentation.opencv.placeholder`

All four placeholders use the same request and response contract. The method ID only tells VISTA which default backend name to send: `yolo`, `anomalib`, `sam`, or `opencv`.

## Shared contract

### What VISTA sends

VISTA sends a `SegmentationInput` payload to your implementation:

```json
{
  "image_data_base64": "<PNG bytes as base64>",
  "backend": "yolo",
  "mode": "default",
  "prompts": {},
  "options": {},
  "metadata": {
    "method_id": "segmentation.yolo.placeholder",
    "method_name": "YOLO (placeholder)"
  }
}
```

Important fields:

- `image_data_base64`: the current image encoded as base64 PNG.
- `backend`: inferred from the selected placeholder.
- `mode`: a user-configured string, usually `default`.
- `prompts`: optional prompt data, most useful for SAM-like models.
- `options`: user-configured backend options such as confidence thresholds, model names, or service timeouts.
- `metadata`: VISTA workflow context.

### What your implementation returns

Return a JSON-serializable dictionary, Pydantic model, or FastAPI JSON response with this shape:

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

Mask fields:

- `bbox`: `[x, y, width, height]` in source-image pixels. This is enough for VISTA to create detection overlays.
- `area`: pixel area or model-reported area.
- `score`: confidence score.
- `label`: stable class or region label.
- `segmentation`: optional polygon, run-length encoding, dense mask reference, or `null`.

VISTA converts returned masks into labels, detections, measurements, and overlay metadata for downstream blocks such as `Region Properties (placeholder)` and `Recipe / Artifact Output`.

## Import path implementation

Use this section first. It assumes the deployed model function can be imported and called from the same Python environment that runs the VISTA backend.

### Developer implementation steps

1. **Put the deployed function on the backend Python path.**
   - Install its package into the VISTA backend environment, or mount/copy the module into an importable location.
   - VISTA also includes repo-local starter adapters you can copy or replace in `backend/utils/segmentation_integrations/`:

     | Placeholder | File to edit | Local Function Path to enter |
     | --- | --- | --- |
     | YOLO | `backend/utils/segmentation_integrations/yolo_backend.py` | `utils.segmentation_integrations.yolo_backend.run` |
     | Anomalib | `backend/utils/segmentation_integrations/anomalib_backend.py` | `utils.segmentation_integrations.anomalib_backend.run` |
     | SAM | `backend/utils/segmentation_integrations/sam_backend.py` | `utils.segmentation_integrations.sam_backend.run` |
     | OpenCV | `backend/utils/segmentation_integrations/opencv_backend.py` | `utils.segmentation_integrations.opencv_backend.run` |

   - Confirm this command works inside the backend environment:

     ```bash
     python -c "from utils.segmentation_integrations.yolo_backend import run; print(run)"
     ```

2. **Expose one callable.**
   - The callable may accept either VISTA's `SegmentationInput` Pydantic model or a plain dictionary.
   - VISTA first calls the function with the Pydantic object. If that raises `TypeError`, VISTA retries with `request.model_dump(mode="python")`.
   - Keep the return value JSON-serializable. Do not return tensors, NumPy arrays, PIL images, or framework-native objects directly.

3. **Decode the image, run inference, and return the shared output shape.**

   ```python
   # my_company/segmentation/yolo_backend.py
   import base64
   import io

   from PIL import Image


   def run(request):
       payload = request.model_dump(mode="python") if hasattr(request, "model_dump") else request
       image_bytes = base64.b64decode(payload["image_data_base64"])
       image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

       # Replace this block with the deployed model call.
       width, height = image.size
       box = [0.1 * width, 0.1 * height, 0.4 * width, 0.4 * height]

       return {
           "backend": payload.get("backend", "yolo"),
           "mode": payload.get("mode", "default"),
           "masks": [
               {
                   "segmentation": None,
                   "bbox": box,
                   "area": box[2] * box[3],
                   "score": 0.9,
                   "label": "object",
               }
           ],
           "metrics": {
               "runtime": "local_import",
               "model": payload.get("options", {}).get("model", "your-model-name"),
           },
           "raw_output": None,
       }
   ```

4. **Configure the Pipeline Studio block.**
   - `Integration Mode`: `local_import`
   - `Local Function Path`: dotted callable path, for example `utils.segmentation_integrations.yolo_backend.run`
   - `Mode`: backend-specific mode string, or `default`
   - `Prompts JSON`: prompt data, or `{}`
   - `Options JSON`: backend-specific values, for example `{"confidence": 0.4, "model": "your-model-name"}`

5. **Verify one representative image.**
   - Run the workflow on an image that should produce at least one mask.
   - Confirm the output block shows the expected `mask_count`.
   - Confirm measurements and detections appear when masks include `bbox` values.

### Import path troubleshooting

- Import errors mean the package is not installed or the dotted path is wrong.
- Attribute errors mean the module imports but the callable name is wrong.
- Serialization errors mean the function returned framework-native objects instead of JSON-safe values.
- Empty overlays usually mean `masks` is empty or mask entries do not include usable geometry such as `bbox`.

## FastAPI implementation

Use this section when the segmentation runtime cannot or should not run inside the VISTA backend process. Common reasons include GPU isolation, conflicting dependencies, separate scaling, or a model service owned by another team.

### Developer implementation steps

1. **Expose a service endpoint that accepts the shared input contract.**

   ```python
   # segmentation_service.py
   import base64
   import io

   from fastapi import FastAPI
   from PIL import Image
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
       image_bytes = base64.b64decode(request.image_data_base64)
       image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

       # Replace this block with the deployed model call.
       width, height = image.size
       box = [0.1 * width, 0.1 * height, 0.4 * width, 0.4 * height]

       return {
           "backend": request.backend,
           "mode": request.mode,
           "masks": [
               {
                   "segmentation": None,
                   "bbox": box,
                   "area": box[2] * box[3],
                   "score": 0.9,
                   "label": "object",
               }
           ],
           "metrics": {
               "runtime": "fastapi",
               "model": request.options.get("model", "your-model-name"),
           },
           "raw_output": None,
       }
   ```

2. **Run the service where model dependencies are available.**

   ```bash
   uvicorn segmentation_service:app --host 0.0.0.0 --port 9000
   ```

3. **Configure the Pipeline Studio block.**
   - `Integration Mode`: `fastapi`
   - `FastAPI URL`: endpoint URL, for example `http://segmenter:9000/segment`
   - `Mode`: backend-specific mode string, or `default`
   - `Prompts JSON`: prompt data, or `{}`
   - `Options JSON`: backend-specific values. For long model runs, include `{"timeout_seconds": 120}`.

4. **Verify connectivity and one representative image.**
   - Confirm the VISTA backend can reach the service URL from its own container or host.
   - Run the workflow on an image that should produce at least one mask.
   - Confirm the output block shows the expected `mask_count`, measurements, detections, and overlay metadata.

### FastAPI troubleshooting

- Connection errors mean the VISTA backend cannot reach the URL from its runtime environment.
- Non-2xx responses are raised as service errors because VISTA calls `raise_for_status()`.
- Timeouts use `options.timeout_seconds` when provided and otherwise use VISTA's default request timeout.
- Response validation errors mean the service returned a body outside the shared output contract.

## Code map

Use these files as the authoritative references when changing or extending the integration:

| What you are checking | Code location |
| --- | --- |
| Placeholder parameters: `integration_mode`, `function_path`, `fastapi_url`, `mode`, `prompts`, and `options` | `backend/analyze_toolbox/methods.py`, `SEGMENTATION_PLACEHOLDER_PARAMETERS` |
| The four placeholder method IDs and manifest entries | `backend/analyze_toolbox/methods.py`, segmentation `MethodSpec` entries in `TOOLBOX_METHODS` |
| UI labels, default values, and editable parameter fields | `frontend/src/components/InspectionWorkbenchPanel.js`, `SEGMENTATION_ML_METHOD_GROUPS`, `DEFAULT_SEGMENTATION_ML_PARAMETERS`, and `SEGMENTATION_ML_PARAMETER_FIELDS` |
| Request and response models: `SegmentationInput`, `SegmentationMask`, and `SegmentationOutput` | `backend/analyze_toolbox/segmentation.py` |
| Runtime dispatch for `placeholder`, `local_import`, and `fastapi` | `backend/analyze_toolbox/segmentation.py`, `SegmentationComponent.run`, `_run_local_import`, and `_run_fastapi` |
| Mapping from placeholder method ID to backend name | `backend/analyze_toolbox/segmentation.py`, `SEGMENTATION_METHOD_BACKENDS` |
| Graph node and edge shape used by Pipeline Studio workflows | `backend/analyze_toolbox/contracts.py`, `WorkflowNodeSpec`, `EdgeSpec`, and `WorkflowGraph` |
| Executor handoff from workflow parameters to `SegmentationInput` | `backend/analyze_toolbox/executor.py`, `_apply_segmentation_component` |
| Conversion of returned masks into labels, detections, measurements, and overlay metadata | `backend/analyze_toolbox/executor.py`, `_apply_segmentation_component` |
| Output artifact behavior after segmentation | `backend/analyze_toolbox/executor.py`, `output.versioned_image_artifact` branch |

## Done checklist

- The selected placeholder has `Integration Mode` set to either `local_import` or `fastapi`.
- The import path or service URL points to a real deployed implementation.
- The implementation accepts the shared request fields.
- The implementation returns JSON-serializable masks, metrics, and optional raw output.
- At least one representative image has been tested end-to-end.
- The output block shows expected mask count, measurements, detections when boxes are present, and overlay metadata.
