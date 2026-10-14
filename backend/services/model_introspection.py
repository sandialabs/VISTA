"""Static introspection of model checkpoint files without executing their code."""

from __future__ import annotations

import builtins
import copy
import importlib
import io
import sys
import types
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any

MAX_GRAPH_NODES = 360
SAFE_STUB_PREFIXES = ("ultralytics.nn.",)


def inspect_checkpoint_file(
    path: str | Path, filename: str | None = None
) -> dict[str, Any]:
    """Inspect a model checkpoint and return JSON-safe metadata and graph data."""
    checkpoint_path = Path(path)
    stat = checkpoint_path.stat()
    return copy.deepcopy(
        _inspect_checkpoint_file_cached(
            str(checkpoint_path),
            filename or checkpoint_path.name,
            stat.st_size,
            stat.st_mtime_ns,
        )
    )


def inspect_checkpoint_bytes(data: bytes, filename: str) -> dict[str, Any]:
    """Inspect checkpoint bytes when no stable local filesystem path exists."""
    result = _base_result()
    return _inspect_checkpoint_payload(
        _load_checkpoint_bytes(data, filename, result), filename, result
    )


@lru_cache(maxsize=32)
def _inspect_checkpoint_file_cached(
    path: str, filename: str, size_bytes: int, mtime_ns: int
) -> dict[str, Any]:
    _ = size_bytes, mtime_ns
    checkpoint_path = Path(path)
    name = filename or checkpoint_path.name
    result = _base_result()

    payload = _load_checkpoint_payload(checkpoint_path, result)
    return _inspect_checkpoint_payload(payload, name, result)


def _base_result() -> dict[str, Any]:
    return {
        "parameter_count": None,
        "parameter_count_kind": None,
        "graph": None,
        "warnings": [],
    }


def _inspect_checkpoint_payload(
    payload: Any | None, name: str, result: dict[str, Any] | None = None
) -> dict[str, Any]:
    result = result or _base_result()

    if payload is None:
        result["graph"] = _empty_graph(
            name, "Checkpoint could not be loaded for introspection"
        )
        return result

    model = _extract_module(payload)
    if model is not None:
        parameter_count = _count_module_parameters(model)
        result["parameter_count"] = parameter_count
        result["parameter_count_kind"] = "module_parameters"
        result["graph"] = _module_graph(model, name, parameter_count)
        return result

    state = _extract_state_dict(payload)
    if state:
        parameter_count = _count_tensors(state)
        result["parameter_count"] = parameter_count
        result["parameter_count_kind"] = "state_dict_tensor_elements"
        result["graph"] = _state_dict_graph(state, name, parameter_count)
        return result

    result["graph"] = _empty_graph(
        name, "Checkpoint does not contain a module or state_dict"
    )
    return result


def _load_checkpoint_bytes(
    data: bytes, filename: str, result: dict[str, Any]
) -> Any | None:
    if Path(filename).suffix.lower() == ".safetensors":
        try:
            from safetensors.torch import load  # noqa: PLC0415
        except Exception as exc:
            result["warnings"].append(
                f"safetensors is not available for introspection: {exc}"
            )
            return None
        try:
            return load(data)
        except Exception:
            return None
    try:
        import torch  # noqa: PLC0415
    except Exception:
        return None
    try:
        return torch.load(io.BytesIO(data), map_location="cpu", weights_only=True)
    except Exception:
        return _load_bytes_with_constrained_safe_globals(torch, data, result)


def _load_bytes_with_constrained_safe_globals(
    torch: Any, data: bytes, result: dict[str, Any]
) -> Any | None:
    serialization = getattr(torch, "serialization", None)
    get_unsafe = getattr(serialization, "get_unsafe_globals_in_checkpoint", None)
    safe_globals = getattr(serialization, "safe_globals", None)
    if not callable(get_unsafe) or not callable(safe_globals):
        return None
    try:
        unsafe_globals = get_unsafe(io.BytesIO(data))
    except Exception as exc:
        result["warnings"].append(f"Could not inspect checkpoint globals: {exc}")
        return None
    allowlist = [
        obj
        for name in unsafe_globals
        if (obj := _safe_global_object(str(name))) is not None
    ]
    if not allowlist:
        return None
    try:
        with safe_globals(allowlist):
            return torch.load(io.BytesIO(data), map_location="cpu", weights_only=True)
    except Exception as exc:
        result["warnings"].append(f"Constrained safe-global load failed: {exc}")
        return None


def _load_checkpoint_payload(path: Path, result: dict[str, Any]) -> Any | None:
    if path.suffix.lower() == ".safetensors":
        return _load_safetensors(path, result)
    try:
        import torch  # noqa: PLC0415
    except Exception as exc:
        result["warnings"].append(
            f"PyTorch is not available for checkpoint introspection: {exc}"
        )
        return None
    try:
        return torch.load(path, map_location="cpu", weights_only=True)
    except Exception as safe_exc:
        payload = _load_with_constrained_safe_globals(torch, path, result)
        if payload is not None:
            return payload
        result["warnings"].append(f"Safe PyTorch checkpoint load failed: {safe_exc}")
        return None


def _load_with_constrained_safe_globals(
    torch: Any, path: Path, result: dict[str, Any]
) -> Any | None:
    serialization = getattr(torch, "serialization", None)
    get_unsafe = getattr(serialization, "get_unsafe_globals_in_checkpoint", None)
    safe_globals = getattr(serialization, "safe_globals", None)
    if not callable(get_unsafe) or not callable(safe_globals):
        return None
    try:
        unsafe_globals = get_unsafe(str(path))
    except Exception as exc:
        result["warnings"].append(f"Could not inspect checkpoint globals: {exc}")
        return None
    allowlist = []
    skipped = []
    for global_name in unsafe_globals:
        obj = _safe_global_object(str(global_name))
        if obj is None:
            skipped.append(str(global_name))
        else:
            allowlist.append(obj)
    if skipped:
        result["warnings"].append(
            "Skipped unsupported checkpoint globals: " + ", ".join(skipped[:8])
        )
    if not allowlist:
        return None
    try:
        with safe_globals(allowlist):
            payload = torch.load(path, map_location="cpu", weights_only=True)
        result.setdefault("signals", []).append(
            "Loaded checkpoint metadata with constrained PyTorch safe globals"
        )
        return payload
    except Exception as exc:
        result["warnings"].append(f"Constrained safe-global load failed: {exc}")
        return None


def _safe_global_object(global_name: str) -> Any | None:
    if global_name == "builtins.getattr":
        return builtins.getattr
    module_name, _, attr_name = global_name.rpartition(".")
    if not module_name or not attr_name:
        return None
    try:
        module = importlib.import_module(module_name)
        return getattr(module, attr_name)
    except Exception:
        if not global_name.startswith(SAFE_STUB_PREFIXES):
            return None
        return _placeholder_module_class(module_name, attr_name)


def _placeholder_module_class(module_name: str, attr_name: str) -> type:
    import torch.nn as nn  # noqa: PLC0415

    for index in range(1, len(module_name.split(".")) + 1):
        partial = ".".join(module_name.split(".")[:index])
        sys.modules.setdefault(partial, types.ModuleType(partial))
    module = sys.modules[module_name]
    existing = getattr(module, attr_name, None)
    if existing is not None:
        return existing

    class PlaceholderModule(nn.Module):
        def __setstate__(self, state: dict[str, Any]) -> None:
            self.__dict__.update(state)

    PlaceholderModule.__name__ = attr_name
    PlaceholderModule.__qualname__ = attr_name
    PlaceholderModule.__module__ = module_name
    setattr(module, attr_name, PlaceholderModule)
    return PlaceholderModule


def _load_safetensors(path: Path, result: dict[str, Any]) -> dict[str, Any] | None:
    try:
        from safetensors.torch import load_file  # noqa: PLC0415
    except Exception as exc:
        result["warnings"].append(
            f"safetensors is not available for introspection: {exc}"
        )
        return None
    try:
        return load_file(str(path), device="cpu")
    except Exception as exc:
        result["warnings"].append(f"safetensors load failed: {exc}")
        return None


def _extract_module(value: Any) -> Any | None:
    try:
        import torch.nn as nn  # noqa: PLC0415
    except Exception:
        return None
    if isinstance(value, nn.Module):
        return value
    if isinstance(value, dict):
        for key in ("model", "ema", "module"):
            nested = value.get(key)
            if isinstance(nested, nn.Module):
                return nested
    return None


def _extract_state_dict(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    for key in ("state_dict", "model", "module"):
        nested = value.get(key)
        if isinstance(nested, dict) and nested:
            return nested
    if value and all(
        hasattr(tensor, "shape") or hasattr(tensor, "numel")
        for tensor in value.values()
    ):
        return value
    return None


def _count_module_parameters(model: Any) -> int | None:
    try:
        return int(sum(parameter.numel() for parameter in model.parameters()))
    except Exception:
        state = model.state_dict() if hasattr(model, "state_dict") else None
        return _count_tensors(state) if isinstance(state, dict) else None


def _count_tensors(state: dict[str, Any]) -> int | None:
    total = 0
    found = False
    for tensor in state.values():
        numel = getattr(tensor, "numel", None)
        if callable(numel):
            try:
                total += int(numel())
                found = True
                continue
            except Exception:
                pass
        shape = getattr(tensor, "shape", None)
        if shape is None:
            continue
        count = 1
        for dim in shape:
            count *= int(dim)
        total += count
        found = True
    return total if found else None


def _module_graph(
    model: Any, filename: str, parameter_count: int | None
) -> dict[str, Any]:
    nodes = []
    edges = []
    total_by_path = _module_parameter_totals(model)
    modules = list(model.named_modules())
    truncated = len(modules) > MAX_GRAPH_NODES
    for index, (name, module) in enumerate(modules[:MAX_GRAPH_NODES]):
        node_id = "root" if not name else f"module:{name}"
        parent_name = name.rpartition(".")[0] if name else None
        parent_id = (
            "root"
            if parent_name == "" and name
            else f"module:{parent_name}"
            if parent_name
            else None
        )
        direct_count = _direct_parameter_count(module)
        nodes.append(
            {
                "id": node_id,
                "label": filename if not name else name.rsplit(".", 1)[-1],
                "path": name or "<root>",
                "type": type(module).__name__,
                "kind": "Module",
                "depth": 0 if not name else name.count(".") + 1,
                "parent": parent_id,
                "parameter_count": int(total_by_path.get(name, direct_count)),
                "direct_parameter_count": int(direct_count),
                "child_count": len(list(module.children())),
                "summary": _module_summary(module),
            }
        )
        if parent_id and index < MAX_GRAPH_NODES:
            edges.append(
                {
                    "source": parent_id,
                    "target": node_id,
                    "label": "contains",
                    "kind": "hierarchy",
                }
            )
    return {
        "source": "torch_module_hierarchy",
        "parameter_count": parameter_count,
        "nodes": nodes,
        "edges": [edge for edge in edges if _node_exists(edge["source"], nodes)],
        "truncated": truncated,
    }


def _module_parameter_totals(model: Any) -> dict[str, int]:
    totals: dict[str, int] = {}
    for name, module in model.named_modules():
        try:
            totals[name] = int(
                sum(parameter.numel() for parameter in module.parameters())
            )
        except Exception:
            totals[name] = 0
    return totals


def _direct_parameter_count(module: Any) -> int:
    try:
        return int(
            sum(parameter.numel() for parameter in module.parameters(recurse=False))
        )
    except Exception:
        return 0


def _module_summary(module: Any) -> str:
    try:
        extra = (
            module.extra_repr() if callable(getattr(module, "extra_repr", None)) else ""
        )
    except Exception:
        extra = ""
    return str(extra or "")[:240]


def _state_dict_graph(
    state: dict[str, Any], filename: str, parameter_count: int | None
) -> dict[str, Any]:
    totals: defaultdict[str, int] = defaultdict(int)
    tensor_counts: defaultdict[str, int] = defaultdict(int)
    for key, tensor in state.items():
        parts = _state_key_parts(str(key))
        tensor_count = _tensor_numel(tensor) or 0
        for depth in range(0, len(parts) + 1):
            prefix = ".".join(parts[:depth])
            totals[prefix] += tensor_count
            tensor_counts[prefix] += 1

    ordered = sorted(totals, key=lambda item: (item.count("."), item))
    nodes = []
    edges = []
    for prefix in ordered[:MAX_GRAPH_NODES]:
        if prefix == "":
            node_id = "root"
            label = filename
            parent_id = None
            depth = 0
        else:
            node_id = f"state:{prefix}"
            label = prefix.rsplit(".", 1)[-1]
            parent = prefix.rpartition(".")[0]
            parent_id = "root" if parent == "" else f"state:{parent}"
            depth = prefix.count(".") + 1
        nodes.append(
            {
                "id": node_id,
                "label": label,
                "path": prefix or "<state_dict>",
                "type": "state_dict" if prefix == "" else "parameter_group",
                "kind": "StateDict",
                "depth": depth,
                "parent": parent_id,
                "parameter_count": int(totals[prefix]),
                "direct_parameter_count": 0,
                "tensor_count": int(tensor_counts[prefix]),
                "summary": f"{tensor_counts[prefix]} tensor entries",
            }
        )
        if parent_id:
            edges.append(
                {
                    "source": parent_id,
                    "target": node_id,
                    "label": "contains",
                    "kind": "hierarchy",
                }
            )
    return {
        "source": "state_dict_hierarchy",
        "parameter_count": parameter_count,
        "nodes": nodes,
        "edges": [edge for edge in edges if _node_exists(edge["source"], nodes)],
        "truncated": len(ordered) > MAX_GRAPH_NODES,
    }


def _state_key_parts(key: str) -> list[str]:
    parts = [part for part in key.split(".") if part]
    if len(parts) <= 1:
        return parts
    return parts[:-1]


def _tensor_numel(tensor: Any) -> int | None:
    numel = getattr(tensor, "numel", None)
    if callable(numel):
        try:
            return int(numel())
        except Exception:
            pass
    shape = getattr(tensor, "shape", None)
    if shape is None:
        return None
    count = 1
    for dim in shape:
        count *= int(dim)
    return count


def _empty_graph(filename: str, message: str) -> dict[str, Any]:
    return {
        "source": "unavailable",
        "parameter_count": None,
        "nodes": [
            {
                "id": "root",
                "label": filename,
                "path": "<checkpoint>",
                "type": "Checkpoint",
                "kind": "Checkpoint",
                "depth": 0,
                "parent": None,
                "parameter_count": None,
                "direct_parameter_count": 0,
                "summary": message,
            }
        ],
        "edges": [],
        "truncated": False,
    }


def _node_exists(node_id: str, nodes: list[dict[str, Any]]) -> bool:
    return any(node["id"] == node_id for node in nodes)
