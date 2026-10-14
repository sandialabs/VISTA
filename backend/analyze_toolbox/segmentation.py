"""SegmentComponent abstraction for user-supplied segmentation integrations.

The placeholders exposed in the Pipeline Studio all flow through this module so
teams can swap a local Python callable or remote FastAPI endpoint without
changing workflow/executor code.
"""

from __future__ import annotations

import base64
import importlib
import io
import sys
import time
import uuid
from abc import ABC, abstractmethod
from datetime import timedelta
from typing import Any, Literal, Self
from urllib.parse import urljoin

import requests
from PIL import Image
from pydantic import BaseModel, Field, model_validator


class FastAPIDiagnosticsError(RuntimeError):
    def __init__(self, message: str, diagnostics: dict[str, Any]):
        super().__init__(message)
        self.diagnostics = diagnostics


class FastAPIAnalysisCancelled(RuntimeError):
    """Raised when a remote FastAPI analysis is stopped by the user."""


def _short_text(value: Any, limit: int = 500) -> str:
    text = str(value or "").replace("\n", " ").strip()
    return text if len(text) <= limit else f"{text[:limit]}..."


def _fastapi_diagnostic_message(diagnostics: dict[str, Any], problem: str) -> str:
    connected = (
        "yes"
        if diagnostics.get("endpoint_connected") is True
        else "no"
        if diagnostics.get("endpoint_connected") is False
        else "unknown"
    )
    attempted = str(diagnostics.get("endpoint_attempted_execution") or "unknown")
    result_returned = (
        "yes"
        if diagnostics.get("result_returned") is True
        else "no"
        if diagnostics.get("result_returned") is False
        else "unknown"
    )
    status = diagnostics.get("http_status")
    status_text = f" HTTP status: {status}." if status is not None else ""
    detail = diagnostics.get("detail")
    detail_text = f" Detail: {_short_text(detail)}" if detail else ""
    return (
        f"FastAPI analysis call did not produce usable annotations or overlays. {problem} "
        f"Connected to endpoint: {connected}. Endpoint attempted execution: {attempted}. "
        f"Result returned: {result_returned}.{status_text}{detail_text}"
    )


class ToolkitBaseModel(BaseModel):
    """Small local equivalent of the deployed toolkit base model."""

    model_config = {"arbitrary_types_allowed": True}


class ToolkitIDBaseModel(ToolkitBaseModel):
    id: str | None = None


class ToolkitComponent(ABC):
    COMPONENT_TYPE: str = "ToolkitComponent"

    @abstractmethod
    def cleanup(self) -> None:
        raise NotImplementedError


class ImageInput(ToolkitIDBaseModel):
    """Common image input model.

    ``image_data_base64`` is used for Pipeline Studio / FastAPI JSON transport.
    ``image`` is available for in-process PIL integrations.
    """

    file: str | None = None
    image: Image.Image | None = Field(default=None, exclude=True)
    image_data_base64: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_source(self) -> Self:
        sources = [
            self.file is not None,
            self.image is not None,
            self.image_data_base64 is not None,
        ]
        if sum(sources) != 1:
            raise ValueError(
                'Exactly one of "file", "image", or "image_data_base64" must be provided'
            )
        return self


class ImageOutput(ToolkitIDBaseModel):
    metrics: dict[str, Any] = Field(default_factory=dict)


class SegmentationMask(ToolkitBaseModel):
    segmentation: Any = None
    bbox: list[float] = Field(default_factory=list)
    area: float | int | None = None
    score: float | None = None
    label: str | None = None


class SegmentationInput(ImageInput):
    backend: Literal["yolo", "anomalib", "sam", "opencv", "fastapi"] = "opencv"
    mode: str = "default"
    prompts: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)


class SegmentationOutput(ImageOutput):
    backend: str
    mode: str
    masks: list[SegmentationMask] = Field(default_factory=list)
    raw_output: Any = None


class ImageComponent(ToolkitComponent, ABC):
    COMPONENT_TYPE: str = "ImageComponent"

    @abstractmethod
    def run(self, data: ImageInput) -> ImageOutput:
        raise NotImplementedError

    def _load_image(self, data: ImageInput) -> Image.Image:
        if data.image is not None:
            return data.image.convert("RGB")
        if data.file is not None:
            return Image.open(data.file).convert("RGB")
        if data.image_data_base64 is not None:
            encoded = data.image_data_base64
            if encoded.startswith("data:") and "," in encoded:
                encoded = encoded.split(",", 1)[1]
            return Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGB")
        raise ValueError(
            'Exactly one of "file", "image", or "image_data_base64" must be provided'
        )


class SegmentationComponent(ImageComponent):
    """Toolkit-facing segmentation component with pluggable backends."""

    COMPONENT_TYPE: str = "SegmentationComponent"

    def run(self, data: SegmentationInput) -> SegmentationOutput:
        integration_mode = (
            str(data.options.get("integration_mode") or "local").strip().lower()
        )
        image = self._load_image(data)  # validates image input before dispatch

        if integration_mode in {"local", "placeholder"}:
            adapter_data = data.model_copy(
                update={
                    "file": None,
                    "image": None,
                    "image_data_base64": pil_image_to_base64(image),
                }
            )
            raw = self._run_local_import(
                adapter_data, function_path=_DEFAULT_PLACEHOLDER_FUNCTIONS[data.backend]
            )
        elif integration_mode == "local_import":
            raw = self._run_local_import(data)
        elif integration_mode in {"remote", "fastapi"}:
            raw = self._run_fastapi(data)
        else:
            raise ValueError(
                f"Unsupported segmentation integration_mode: {integration_mode}"
            )
        return self._normalize_result(raw, data.backend, data.mode)

    def _run_local_import(
        self, data: SegmentationInput, *, function_path: str | None = None
    ) -> Any:
        function_path = function_path or str(data.options.get("function_path") or "")
        if not function_path or "." not in function_path:
            raise ValueError(
                "local_import mode requires options.function_path, e.g. my_package.segmenters.run"
            )
        module_name, function_name = function_path.rsplit(".", 1)
        module = self._import_local_module(module_name)
        function = getattr(module, function_name)
        try:
            return function(data)
        except TypeError:
            return function(data.model_dump(mode="python", exclude={"image"}))

    def _import_local_module(self, module_name: str):
        module = importlib.import_module(module_name)
        backend_module_name = f"backend.{module_name}"
        if module_name.startswith("utils.") and backend_module_name in sys.modules:
            return sys.modules[backend_module_name]
        return module

    def _run_fastapi(self, data: SegmentationInput) -> Any:
        fastapi_url = str(data.options.get("fastapi_url") or "")
        if not fastapi_url:
            raise ValueError("fastapi mode requires options.fastapi_url")
        request_format = str(data.options.get("request_format") or "vista_segmentation")
        diagnostics: dict[str, Any] = {
            "runtime": "remote_fastapi",
            "fastapi_url": fastapi_url,
            "request_format": request_format,
            "request_prepared": False,
            "endpoint_connected": None,
            "endpoint_attempted_execution": "unknown",
            "result_returned": False,
            "result_usable_for_overlay": False,
        }
        try:
            payload = self._fastapi_payload(data)
            diagnostics["request_prepared"] = True
        except Exception as exc:
            diagnostics.update({"failure_stage": "prepare_request", "detail": str(exc)})
            raise FastAPIDiagnosticsError(
                _fastapi_diagnostic_message(
                    diagnostics, "VISTA could not build the request payload."
                ),
                diagnostics,
            ) from exc
        session = requests.Session()
        if bool(data.options.get("disable_proxy")):
            session.trust_env = False
        try:
            response = session.post(
                fastapi_url,
                json=payload,
                timeout=float(data.options.get("timeout_seconds", 60)),
            )
            diagnostics.update(
                {
                    "endpoint_connected": True,
                    "http_status": getattr(response, "status_code", 200),
                }
            )
        except requests.Timeout as exc:
            diagnostics.update(
                {
                    "endpoint_connected": None,
                    "failure_stage": "timeout",
                    "detail": str(exc),
                }
            )
            raise FastAPIDiagnosticsError(
                _fastapi_diagnostic_message(
                    diagnostics, "The request timed out before a response was received."
                ),
                diagnostics,
            ) from exc
        except requests.ConnectionError as exc:
            diagnostics.update(
                {
                    "endpoint_connected": False,
                    "failure_stage": "connect",
                    "detail": str(exc),
                }
            )
            raise FastAPIDiagnosticsError(
                _fastapi_diagnostic_message(
                    diagnostics, "VISTA could not connect to the configured endpoint."
                ),
                diagnostics,
            ) from exc
        except requests.RequestException as exc:
            diagnostics.update(
                {
                    "endpoint_connected": None,
                    "failure_stage": "request",
                    "detail": str(exc),
                }
            )
            raise FastAPIDiagnosticsError(
                _fastapi_diagnostic_message(
                    diagnostics,
                    "The HTTP request failed before a usable response was received.",
                ),
                diagnostics,
            ) from exc

        response_status = getattr(response, "status_code", 200)
        if response_status >= 400:
            diagnostics.update(
                {
                    "endpoint_attempted_execution": "no"
                    if response.status_code in {400, 401, 403, 404, 405, 422}
                    else "unknown",
                    "failure_stage": "http_error",
                    "detail": _short_text(
                        getattr(response, "text", "")
                        or getattr(response, "content", "")
                    ),
                }
            )
            raise FastAPIDiagnosticsError(
                _fastapi_diagnostic_message(
                    diagnostics, "The endpoint returned an HTTP error."
                ),
                diagnostics,
            )

        diagnostics["endpoint_attempted_execution"] = "yes"
        try:
            result = response.json()
            diagnostics["result_returned"] = True
        except ValueError as exc:
            diagnostics.update({"failure_stage": "parse_json", "detail": str(exc)})
            raise FastAPIDiagnosticsError(
                _fastapi_diagnostic_message(
                    diagnostics,
                    "The endpoint responded, but the body was not valid JSON.",
                ),
                diagnostics,
            ) from exc

        if request_format in {"gpu_inference_job", "gpu_inference_presigned"}:
            return self._gpu_inference_job_result(
                result,
                fastapi_url=fastapi_url,
                options=data.options,
                session=session,
                mode=data.mode,
                diagnostics=diagnostics,
            )
        result = self._attach_fastapi_diagnostics(result, diagnostics)
        return result

    def _attach_fastapi_diagnostics(
        self, result: Any, diagnostics: dict[str, Any]
    ) -> Any:
        next_diagnostics = dict(diagnostics)
        if isinstance(result, dict):
            masks = result.get("masks")
            result_usable = isinstance(masks, list) and len(masks) > 0
            next_diagnostics["result_usable_for_overlay"] = result_usable
            next_result = dict(result)
            metrics = dict(next_result.get("metrics") or {})
            metrics["fastapi_diagnostics"] = next_diagnostics
            if not result_usable:
                metrics.setdefault(
                    "runtime_warning",
                    _fastapi_diagnostic_message(
                        next_diagnostics,
                        "The endpoint response did not include any masks.",
                    ),
                )
            next_result["metrics"] = metrics
            return next_result
        if isinstance(result, list):
            next_diagnostics["result_usable_for_overlay"] = len(result) > 0
            if len(result) == 0:
                return {
                    "masks": [],
                    "metrics": {
                        "runtime": "remote_fastapi",
                        "prediction_count": 0,
                        "fastapi_diagnostics": next_diagnostics,
                        "runtime_warning": _fastapi_diagnostic_message(
                            next_diagnostics,
                            "The endpoint response was an empty prediction list.",
                        ),
                    },
                    "raw_output": result,
                }
        return result

    def _fastapi_payload(self, data: SegmentationInput) -> dict[str, Any]:
        request_format = str(data.options.get("request_format") or "vista_segmentation")
        if request_format == "gpu_inference_presigned":
            return self._gpu_inference_presigned_payload(data)
        payload = data.model_dump(mode="json", exclude={"image", "options"})
        payload["options"] = {
            key: value
            for key, value in data.options.items()
            if not str(key).startswith("_")
        }
        if request_format == "gpu_inference_job":
            input_s3_uri = data.options.get("input_s3_uri") or data.metadata.get(
                "s3_uri"
            )
            output_bucket = data.options.get("output_bucket") or data.metadata.get(
                "s3_bucket"
            )
            namespace = data.options.get("namespace") or data.metadata.get(
                "s3_namespace"
            )
            allowed_keys = {
                "input_s3_uri",
                "username",
                "password",
                "output_bucket",
                "output_prefix",
                "namespace",
                "verify_ssl",
                "prefer_secret_key",
                "disable_proxy",
                "use_kerberos_ticket",
                "workspace_dir",
            }
            payload = {
                key: data.options[key]
                for key in allowed_keys
                if data.options.get(key) is not None
            }
            if input_s3_uri:
                payload["input_s3_uri"] = input_s3_uri
            if output_bucket:
                payload["output_bucket"] = output_bucket
            if namespace:
                payload["namespace"] = namespace
            return payload
        if request_format != "capvision_process":
            return payload
        filename = str(
            data.metadata.get("filename")
            or data.options.get("filename")
            or "vista-image.png"
        )
        return {
            "data": {
                "imgs": [
                    {"filename": filename, "image_data_base64": data.image_data_base64}
                ],
                "image_data_base64": data.image_data_base64,
                "filename": filename,
                "serial_num": str(
                    data.options.get("serial_num")
                    or data.metadata.get("serial_num")
                    or "vista-image"
                ),
                "lot_num": str(
                    data.options.get("lot_num")
                    or data.metadata.get("lot_num")
                    or "vista"
                ),
            }
        }

    def _gpu_inference_presigned_payload(
        self, data: SegmentationInput
    ) -> dict[str, Any]:
        from core.config import settings
        from utils.boto3_client import (
            get_presigned_download_url,
            get_presigned_upload_url,
        )

        options = data.options
        bucket = str(
            options.get("bucket")
            or data.metadata.get("s3_bucket")
            or settings.S3_BUCKET
        )
        input_key = str(
            options.get("input_object_key")
            or data.metadata.get("object_storage_key")
            or ""
        )
        if not input_key:
            raise ValueError(
                "gpu_inference_presigned requires a VISTA image object_storage_key or options.input_object_key"
            )
        expires_seconds = float(
            options.get("presigned_url_expiry_seconds")
            or settings.ML_PRESIGNED_URL_EXPIRY_SECONDS
        )
        expires_delta = timedelta(seconds=expires_seconds)
        input_url = get_presigned_download_url(
            bucket, input_key, expires_delta=expires_delta
        )
        if not input_url:
            raise RuntimeError("Failed to generate presigned input download URL")

        output_prefix = str(options.get("output_prefix") or "predictions").strip("/")
        run_token = str(options.get("output_run_id") or uuid.uuid4())
        output_base = f"{output_prefix}/{run_token}" if output_prefix else run_token
        outputs: dict[str, dict[str, Any]] = {}
        output_filenames = {
            "prediction": str(options.get("prediction_filename") or "prediction.npy"),
            "confidence": str(options.get("confidence_filename") or "confidence.npy"),
        }
        if bool(options.get("include_probabilities")):
            output_filenames["probabilities"] = str(
                options.get("probabilities_filename") or "probabilities.npy"
            )
        for kind, filename in output_filenames.items():
            object_key = str(
                options.get(f"{kind}_object_key") or f"{output_base}/{filename}"
            )
            upload_url = get_presigned_upload_url(
                bucket,
                object_key,
                expires_delta=expires_delta,
                content_type="application/octet-stream",
            )
            if not upload_url:
                raise RuntimeError(
                    f"Failed to generate presigned upload URL for {kind}"
                )
            outputs[kind] = {
                "upload_url": upload_url,
                "object_key": object_key,
                "content_type": "application/octet-stream",
            }

        return {
            "input": {
                "download_url": input_url,
                "filename": str(
                    data.metadata.get("filename")
                    or options.get("filename")
                    or "vista-image"
                ),
            },
            "outputs": outputs,
            "disable_proxy": bool(options.get("disable_proxy", True)),
        }

    def _gpu_inference_job_result(
        self,
        result: Any,
        *,
        fastapi_url: str,
        options: dict[str, Any],
        session: requests.Session,
        mode: str,
        diagnostics: dict[str, Any],
    ) -> dict[str, Any]:
        if not isinstance(result, dict) or not result.get("job_id"):
            next_diagnostics = {
                **diagnostics,
                "failure_stage": "job_response",
                "detail": "The endpoint response did not include a job_id.",
            }
            return {
                "backend": "gpu_inference_api",
                "mode": mode,
                "masks": [],
                "metrics": {
                    "runtime": "gpu_inference_api.job",
                    "fastapi_diagnostics": next_diagnostics,
                    "runtime_warning": _fastapi_diagnostic_message(
                        next_diagnostics,
                        "The endpoint responded, but did not return a usable GPU inference job response.",
                    ),
                },
                "raw_output": result,
            }

        job_id = str(result["job_id"])
        remote_job_callback = options.get("_remote_job_callback")
        if callable(remote_job_callback):
            remote_job_callback(fastapi_url, job_id)
        wait_for_completion = bool(options.get("wait_for_completion"))
        job_payload = result
        if wait_for_completion:
            cancel_check = options.get("_cancel_check")
            poll_interval = max(0.5, float(options.get("poll_interval_seconds") or 2.0))
            stall_timeout = max(
                poll_interval,
                float(
                    options.get("job_stall_timeout_seconds")
                    or options.get("job_timeout_seconds")
                    or options.get("timeout_seconds")
                    or 300
                ),
            )
            last_response_at = time.monotonic()
            poll_count = 0
            jobs_url = urljoin(fastapi_url.rsplit("/", 1)[0] + "/", f"jobs/{job_id}")
            last_poll_error = None
            while True:
                if callable(cancel_check) and cancel_check():
                    self._request_remote_job_stop(session, fastapi_url, job_id, options)
                    raise FastAPIAnalysisCancelled(
                        f"Remote GPU inference job {job_id} was stopped by the user."
                    )
                try:
                    response = session.get(
                        jobs_url, timeout=float(options.get("timeout_seconds", 60))
                    )
                    response.raise_for_status()
                    job_payload = response.json()
                    poll_count += 1
                    last_response_at = time.monotonic()
                    last_poll_error = None
                except requests.RequestException as exc:
                    last_poll_error = str(exc)
                    if time.monotonic() - last_response_at >= stall_timeout:
                        job_payload = {
                            **job_payload,
                            "status": "timeout",
                            "poll_error": last_poll_error,
                        }
                        break
                    time.sleep(poll_interval)
                    continue
                if job_payload.get("status") in {"completed", "failed"}:
                    break
                time.sleep(poll_interval)
            job_payload = {
                **job_payload,
                "vista_poll_count": poll_count,
                "vista_last_poll_error": last_poll_error,
            }

        status = str(job_payload.get("status") or result.get("status") or "queued")
        logs = (
            job_payload.get("logs") if isinstance(job_payload.get("logs"), list) else []
        )
        uploaded_outputs = job_payload.get("uploaded_outputs", [])
        next_diagnostics = {
            **diagnostics,
            "endpoint_attempted_execution": "yes",
            "result_returned": True,
            "remote_job_id": job_id,
            "remote_job_status": status,
            "remote_return_code": job_payload.get("return_code"),
            "remote_uploaded_output_count": len(uploaded_outputs)
            if isinstance(uploaded_outputs, list)
            else 0,
            "remote_log_tail": logs[-10:],
            "remote_log_count": len(logs),
            "remote_poll_count": job_payload.get("vista_poll_count"),
            "remote_last_poll_error": job_payload.get("vista_last_poll_error")
            or job_payload.get("poll_error"),
            "result_usable_for_overlay": status == "completed"
            and bool(uploaded_outputs),
        }
        metrics = {
            "runtime": "gpu_inference_api.job",
            "job_id": job_id,
            "job_status": status,
            "return_code": job_payload.get("return_code"),
            "uploaded_outputs": uploaded_outputs,
            "log_tail": logs[-10:],
            "log_count": len(logs),
            "poll_count": job_payload.get("vista_poll_count"),
            "fastapi_diagnostics": next_diagnostics,
        }
        if status == "failed":
            metrics["runtime_warning"] = _fastapi_diagnostic_message(
                next_diagnostics,
                f"Remote GPU inference job {job_id} failed.",
            )
        elif status == "timeout":
            metrics["runtime_warning"] = _fastapi_diagnostic_message(
                next_diagnostics,
                f"Remote GPU inference job {job_id} did not finish before the configured timeout.",
            )
        elif status in {"queued", "running"}:
            metrics["runtime_warning"] = _fastapi_diagnostic_message(
                next_diagnostics,
                f"Remote GPU inference job {job_id} is {status}; no annotation/overlay result is available yet.",
            )
        elif status == "completed" and not uploaded_outputs:
            metrics["runtime_warning"] = _fastapi_diagnostic_message(
                next_diagnostics,
                f"Remote GPU inference job {job_id} completed but did not report uploaded outputs.",
            )
        return {
            "backend": "gpu_inference_api",
            "mode": mode,
            "masks": [],
            "metrics": metrics,
            "raw_output": job_payload,
        }

    def _request_remote_job_stop(
        self,
        session: requests.Session,
        fastapi_url: str,
        job_id: str,
        options: dict[str, Any],
    ) -> None:
        timeout = float(options.get("timeout_seconds", 60))
        base_url = fastapi_url.rsplit("/", 1)[0] + "/"
        for method, path in (
            ("post", f"jobs/{job_id}/cancel"),
            ("post", f"jobs/{job_id}/stop"),
            ("delete", f"jobs/{job_id}"),
        ):
            try:
                response = getattr(session, method)(
                    urljoin(base_url, path), timeout=timeout
                )
                if getattr(response, "status_code", 500) < 400:
                    return
            except requests.RequestException:
                continue

    def _normalize_result(
        self, result: Any, backend: str, mode: str
    ) -> SegmentationOutput:
        if isinstance(result, SegmentationOutput):
            return result
        if isinstance(result, BaseModel):
            result = result.model_dump(mode="python")

        masks_data: list[Any] = []
        metrics: dict[str, Any] = {}
        if isinstance(result, dict):
            result = self._unwrap_fastapi_result(result)

        if isinstance(result, dict):
            masks_data = result.get("masks", []) or []
            metrics = result.get("metrics", {}) or {}
            backend = str(result.get("backend") or backend)
            mode = str(result.get("mode") or mode)
        elif isinstance(result, list):
            masks_data = self._masks_from_capvision_predictions(result)
            metrics = {"runtime": "remote_fastapi", "prediction_count": len(result)}

        masks = [
            mask
            if isinstance(mask, SegmentationMask)
            else SegmentationMask.model_validate(mask)
            for mask in masks_data
        ]
        raw_output = result.get("raw_output") if isinstance(result, dict) else result
        return SegmentationOutput(
            backend=backend,
            mode=mode,
            masks=masks,
            metrics=metrics,
            raw_output=raw_output,
        )

    def _unwrap_fastapi_result(self, result: dict[str, Any]) -> Any:
        if isinstance(result.get("data"), dict):
            data = result["data"]
            if "result" in data:
                return data["result"]
            return data
        if "result" in result and not result.get("masks"):
            return result["result"]
        return result

    def _masks_from_capvision_predictions(
        self, predictions: list[Any]
    ) -> list[dict[str, Any]]:
        masks = []
        for index, prediction in enumerate(predictions, start=1):
            if not isinstance(prediction, dict):
                continue
            box = prediction.get("box")
            if isinstance(box, dict):
                try:
                    x1 = float(box.get("x1", 0) or 0)
                    y1 = float(box.get("y1", 0) or 0)
                    x2 = float(box.get("x2", x1) or x1)
                    y2 = float(box.get("y2", y1) or y1)
                except (TypeError, ValueError):
                    continue
                bbox = [x1, y1, max(1.0, x2 - x1), max(1.0, y2 - y1)]
            else:
                raw_bbox = prediction.get("bbox")
                if not isinstance(raw_bbox, (list, tuple)) or len(raw_bbox) < 4:
                    continue
                try:
                    bbox = [float(value) for value in raw_bbox[:4]]
                except (TypeError, ValueError):
                    continue
            confidence = prediction.get("confidence", prediction.get("score"))
            try:
                score = None if confidence is None else float(confidence)
            except (TypeError, ValueError):
                score = None
            label = (
                prediction.get("category")
                or prediction.get("name")
                or prediction.get("label")
                or f"remote-{index}"
            )
            masks.append(
                {
                    "segmentation": prediction.get("segments"),
                    "bbox": bbox,
                    "area": bbox[2] * bbox[3],
                    "score": score,
                    "label": str(label),
                }
            )
        return masks

    def cleanup(self) -> None:
        return None


def pil_image_to_base64(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


SEGMENTATION_METHOD_BACKENDS = {
    "segmentation.yolo.placeholder": "yolo",
    "segmentation.anomalib.placeholder": "anomalib",
    "segmentation.sam.placeholder": "sam",
    "segmentation.opencv.placeholder": "opencv",
    "segmentation.fastapi.remote": "fastapi",
}


_DEFAULT_PLACEHOLDER_FUNCTIONS = {
    "yolo": "utils.segmentation_integrations.yolo_backend.run",
    "anomalib": "utils.segmentation_integrations.anomalib_backend.run",
    "sam": "utils.segmentation_integrations.sam_backend.run",
    "opencv": "utils.segmentation_integrations.opencv_backend.run",
}
