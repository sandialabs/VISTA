"""Convert PT3 voxel volumes into deterministic Gaussian splat assets.

The converter is intentionally dependency-light: it consumes VolumeInfo from
``utils.volume_loader`` plus either decoded voxel data or readable source image
paths, then emits a small interchange asset (.ply, .splat JSON, or metadata
JSON) suitable for caching and downstream rendering pipelines.
"""

from __future__ import annotations

import hashlib
import json
import math
import struct
import uuid
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageSequence

from utils.pt3_segmentation import normalize_inline_pt3_segmentation_labels
from utils.volume_loader import VolumeInfo

SplatOutputFormat = Literal["ply", "splat", "json"]
MAX_REFERENCE_SPLATS = 100_000


@dataclass(frozen=True)
class TransferFunction:
    threshold: float = 1.0
    intensity_min: float = 0.0
    intensity_max: float = 255.0
    opacity_min: float = 0.05
    opacity_max: float = 1.0
    color_map: str = "grayscale"


@dataclass(frozen=True)
class SplatConversionParams:
    transfer_function: TransferFunction = TransferFunction()
    downsample: int = 1
    max_splats: int | None = 100_000
    output_format: SplatOutputFormat = "ply"


@dataclass(frozen=True)
class SplatPrimitive:
    x: float
    y: float
    z: float
    scale: float
    opacity: float
    red: int
    green: int
    blue: int
    intensity: float
    segment_id: int | None = None


@dataclass(frozen=True)
class SplatAsset:
    path: str
    cache_key: str
    output_format: SplatOutputFormat
    splat_count: int
    metadata: dict[str, Any]


def build_splat_cache_key(
    volume_info: VolumeInfo,
    *,
    volume_stack_id: str,
    source_image_ids: Sequence[str] | None = None,
    params: SplatConversionParams | None = None,
    segmentation_labels: Any | None = None,
    voxel_data: Sequence[Sequence[Sequence[float]]] | None = None,
) -> str:
    """Return a stable cache key for a PT3 volume conversion contract."""
    source_content_digest = _volume_source_content_digest(
        volume_info,
        voxel_data=voxel_data,
    )
    payload = {
        # Version 4 removes job-specific absolute paths and keys the actual
        # source/voxel content instead.
        "version": 4,
        "volume_stack_id": volume_stack_id,
        "source_image_ids": sorted(str(item) for item in (source_image_ids or ())),
        "source_file_names": [Path(item).name for item in volume_info.source_files],
        "source_content_sha256": source_content_digest,
        "dimensions": tuple(int(value) for value in volume_info.shape),
        "format": volume_info.format,
        "dtype": volume_info.dtype,
        "params": asdict(params or SplatConversionParams()),
        "segmentation_sha256": (
            hashlib.sha256(segmentation_labels.tobytes(order="C")).hexdigest()
            if segmentation_labels is not None
            else None
        ),
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"pt3-splat-{digest}"


def _volume_source_content_digest(
    volume_info: VolumeInfo,
    *,
    voxel_data: Sequence[Sequence[Sequence[float]]] | None,
) -> str:
    """Hash stable source bytes or caller-supplied decoded voxels."""

    digest = hashlib.sha256()
    if voxel_data is not None:
        digest.update(b"voxel-data-v1\0")
        count = 0
        for z, y, x, value in _iter_decoded_voxels(voxel_data):
            digest.update(struct.pack("<QQQd", z, y, x, float(value)))
            count += 1
        digest.update(struct.pack("<Q", count))
        return digest.hexdigest()

    digest.update(b"source-files-v1\0")
    for index, raw_source_path in enumerate(volume_info.source_files):
        source_path = Path(raw_source_path)
        try:
            source_size = source_path.stat().st_size
            digest.update(
                json.dumps(
                    [index, source_path.name, source_size],
                    separators=(",", ":"),
                ).encode("utf-8")
            )
            digest.update(b"\0")
            with source_path.open("rb") as source:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
            digest.update(b"\0")
        except OSError as exc:
            raise ValueError(
                f"Could not hash volume source {source_path.name}"
            ) from exc
    return digest.hexdigest()


def convert_volume_to_splat_asset(
    volume_info: VolumeInfo,
    *,
    volume_stack_id: str,
    output_dir: str | Path,
    source_image_ids: Sequence[str] | None = None,
    params: SplatConversionParams | None = None,
    voxel_data: Sequence[Sequence[Sequence[float]]] | None = None,
    segmentation: Mapping[str, Any] | None = None,
) -> SplatAsset:
    """Materialize a cached splat asset for a supported PT3 volume."""
    if volume_info.channel_count != 1:
        raise ValueError(
            "Simplified 3DGS conversion supports scalar volumes only; "
            f"received {volume_info.color_mode.upper()} volume data"
        )
    conversion_params = params or SplatConversionParams()
    _validate_params(conversion_params)
    segmentation_labels = normalize_inline_pt3_segmentation_labels(
        segmentation, volume_info.shape
    )
    cache_key = build_splat_cache_key(
        volume_info,
        volume_stack_id=volume_stack_id,
        source_image_ids=source_image_ids,
        params=conversion_params,
        segmentation_labels=segmentation_labels,
        voxel_data=voxel_data,
    )
    extension = (
        "json"
        if conversion_params.output_format in {"json", "splat"}
        else conversion_params.output_format
    )
    asset_dir = Path(output_dir)
    asset_dir.mkdir(parents=True, exist_ok=True)
    asset_path = asset_dir / f"{cache_key}.{extension}"

    if asset_path.is_file():
        try:
            cached_splat_count = _cached_splat_count(asset_path)
        except (OSError, UnicodeError, ValueError):
            # A legacy/interrupted non-atomic write must never poison this
            # content key. Regenerate it and atomically replace the bad file.
            pass
        else:
            metadata = _metadata(
                volume_info,
                volume_stack_id,
                source_image_ids,
                conversion_params,
                cache_key,
                None,
                segmentation_labels is not None,
            )
            return SplatAsset(
                str(asset_path),
                cache_key,
                conversion_params.output_format,
                cached_splat_count,
                metadata,
            )

    def iter_splats() -> Iterable[SplatPrimitive]:
        return _iter_splats(
            volume_info,
            conversion_params,
            voxel_data=voxel_data,
            segmentation_labels=segmentation_labels,
        )

    # Count first, then decode a second time while retaining at most the hard
    # output budget.  The previous implementation built one Python dataclass
    # per active voxel before capping, so a valid large volume could exhaust
    # server memory even when the requested asset contained only a few splats.
    splats = _collect_splats_to_budget(
        iter_splats,
        conversion_params.max_splats,
        preserve_segment_buckets=segmentation_labels is not None,
    )

    metadata = _metadata(
        volume_info,
        volume_stack_id,
        source_image_ids,
        conversion_params,
        cache_key,
        len(splats),
        segmentation_labels is not None,
    )
    if conversion_params.output_format == "ply":
        _write_asset_atomically(
            asset_path,
            lambda temporary_path: _write_ply(temporary_path, splats),
        )
    else:
        _write_asset_atomically(
            asset_path,
            lambda temporary_path: _write_json(
                temporary_path,
                splats,
                metadata,
                include_splats=conversion_params.output_format == "splat",
            ),
        )
    return SplatAsset(
        str(asset_path),
        cache_key,
        conversion_params.output_format,
        len(splats),
        metadata,
    )


def _sample_splats_to_budget(
    splats: Sequence[SplatPrimitive],
    max_splats: int,
    *,
    preserve_segment_buckets: bool,
) -> list[SplatPrimitive]:
    """Deterministically cap splats, preserving represented segments when possible.

    Label 0 is represented by ``segment_id=None`` and participates as its own
    unsegmented bucket.  When the budget covers every bucket, each bucket first
    receives one slot and the remainder is allocated proportionally to its
    remaining population using largest remainders.  When there are more buckets
    than slots, the largest buckets are retained, with first occurrence as the
    deterministic tie-break.  The result never exceeds ``max_splats``.

    Assets without segmentation retain the converter's legacy global-stride
    behavior so existing visual output remains stable.
    """
    if len(splats) <= max_splats:
        return list(splats)
    if not preserve_segment_buckets:
        stride = max(1, math.ceil(len(splats) / max_splats))
        return list(splats[::stride][:max_splats])

    buckets: dict[int | None, list[int]] = {}
    first_occurrence: dict[int | None, int] = {}
    for index, splat in enumerate(splats):
        bucket = splat.segment_id
        buckets.setdefault(bucket, []).append(index)
        first_occurrence.setdefault(bucket, index)

    quotas = _allocate_segment_quotas(
        {bucket: len(indices) for bucket, indices in buckets.items()},
        first_occurrence,
        max_splats,
    )

    selected_indices: set[int] = set()
    for bucket, quota in quotas.items():
        indices = buckets[bucket]
        if quota == 1:
            selected_indices.add(indices[0])
            continue
        # Include both ends of each bucket's ordered population and space the
        # other representatives evenly between them.
        denominator = quota - 1
        for sample_index in range(quota):
            offset = round(sample_index * (len(indices) - 1) / denominator)
            selected_indices.add(indices[offset])

    return [splat for index, splat in enumerate(splats) if index in selected_indices]


def _allocate_segment_quotas(
    counts: Mapping[int | None, int],
    first_occurrence: Mapping[int | None, int],
    max_splats: int,
) -> dict[int | None, int]:
    """Allocate a deterministic proportional budget across label buckets."""

    bucket_ids = list(counts)
    if max_splats < len(bucket_ids):
        retained = sorted(
            bucket_ids,
            key=lambda bucket: (-counts[bucket], first_occurrence[bucket]),
        )[:max_splats]
        return {bucket: 1 for bucket in retained}

    quotas = {bucket: 1 for bucket in bucket_ids}
    remaining_slots = max_splats - len(bucket_ids)
    remaining_population = sum(counts[bucket] - 1 for bucket in bucket_ids)
    if not remaining_slots or not remaining_population:
        return quotas

    remainders: list[tuple[float, int, int | None]] = []
    allocated = 0
    for bucket in bucket_ids:
        capacity = counts[bucket] - 1
        exact_share = remaining_slots * capacity / remaining_population
        whole_share = min(capacity, math.floor(exact_share))
        quotas[bucket] += whole_share
        allocated += whole_share
        remainders.append((exact_share - whole_share, first_occurrence[bucket], bucket))
    leftover = remaining_slots - allocated
    for _remainder, _first, bucket in sorted(
        remainders, key=lambda item: (-item[0], item[1])
    ):
        if not leftover:
            break
        if quotas[bucket] < counts[bucket]:
            quotas[bucket] += 1
            leftover -= 1
    return quotas


def _collect_splats_to_budget(
    splat_factory: Callable[[], Iterable[SplatPrimitive]],
    max_splats: int,
    *,
    preserve_segment_buckets: bool,
) -> list[SplatPrimitive]:
    """Two-pass bounded collector used by the reference CPU converter.

    The first pass stores only counts (at most 256 segmentation buckets).  The
    second pass retains no more than ``max_splats`` dataclasses, while matching
    the legacy global-stride policy or the segment-proportional policy exactly.
    """

    total = 0
    counts: dict[int | None, int] = {}
    first_occurrence: dict[int | None, int] = {}
    for splat in splat_factory():
        bucket = splat.segment_id if preserve_segment_buckets else None
        counts[bucket] = counts.get(bucket, 0) + 1
        first_occurrence.setdefault(bucket, total)
        total += 1

    if total <= max_splats:
        return list(splat_factory())
    if not preserve_segment_buckets:
        stride = max(1, math.ceil(total / max_splats))
        selected: list[SplatPrimitive] = []
        for index, splat in enumerate(splat_factory()):
            if index % stride == 0:
                selected.append(splat)
                if len(selected) >= max_splats:
                    break
        return selected

    quotas = _allocate_segment_quotas(counts, first_occurrence, max_splats)
    targets: dict[int | None, list[int]] = {}
    for bucket, quota in quotas.items():
        population = counts[bucket]
        if quota == 1:
            targets[bucket] = [0]
        else:
            targets[bucket] = [
                round(sample_index * (population - 1) / (quota - 1))
                for sample_index in range(quota)
            ]

    seen = {bucket: 0 for bucket in counts}
    target_positions = {bucket: 0 for bucket in targets}
    selected = []
    for splat in splat_factory():
        bucket = splat.segment_id
        ordinal = seen[bucket]
        seen[bucket] = ordinal + 1
        bucket_targets = targets.get(bucket)
        if not bucket_targets:
            continue
        target_position = target_positions[bucket]
        if ordinal == bucket_targets[target_position]:
            selected.append(splat)
            target_position += 1
            target_positions[bucket] = target_position
            if target_position == len(bucket_targets):
                targets.pop(bucket)
            if len(selected) >= max_splats:
                break
    return selected


def _validate_params(params: SplatConversionParams) -> None:
    if params.downsample < 1:
        raise ValueError("downsample must be at least 1")
    if (
        isinstance(params.max_splats, bool)
        or not isinstance(params.max_splats, int)
        or not 1 <= params.max_splats <= MAX_REFERENCE_SPLATS
    ):
        raise ValueError(
            f"max_splats must be an integer from 1 through {MAX_REFERENCE_SPLATS}"
        )
    tf = params.transfer_function
    if tf.intensity_max <= tf.intensity_min:
        raise ValueError("intensity_max must be greater than intensity_min")
    if tf.threshold < tf.intensity_min or tf.threshold > tf.intensity_max:
        raise ValueError("threshold must be within the intensity range")


def _iter_splats(
    volume_info: VolumeInfo,
    params: SplatConversionParams,
    *,
    voxel_data=None,
    segmentation_labels=None,
) -> Iterable[SplatPrimitive]:
    source = (
        _iter_decoded_voxels(voxel_data)
        if voxel_data is not None
        else _iter_source_voxels(volume_info)
    )
    step = params.downsample
    for z, y, x, value in source:
        if z % step or y % step or x % step:
            continue
        segment_id = (
            int(segmentation_labels[z, y, x]) if segmentation_labels is not None else 0
        )
        splat = _splat_from_intensity(
            x,
            y,
            z,
            float(value),
            params,
            segment_id=segment_id or None,
        )
        if splat is not None:
            yield splat


def _iter_decoded_voxels(voxel_data):
    for z, plane in enumerate(voxel_data):
        for y, row in enumerate(plane):
            for x, value in enumerate(row):
                yield z, y, x, value


def _iter_source_voxels(volume_info: VolumeInfo):
    if volume_info.format == "slice_stack":
        for z, source_file in enumerate(volume_info.source_files):
            with Image.open(source_file) as image:
                yield from _iter_image_pixels(z, image)
        return
    if volume_info.format == "multipage_tiff":
        with Image.open(volume_info.source_files[0]) as image:
            for z, frame in enumerate(ImageSequence.Iterator(image)):
                yield from _iter_image_pixels(z, frame)
        return
    raise ValueError("Decoded voxel_data is required for non-image volume formats")


def _iter_image_pixels(z: int, image: Image.Image):
    grayscale = image.convert("L")
    width, height = grayscale.size
    pixels = grayscale.load()
    for y in range(height):
        for x in range(width):
            yield z, y, x, pixels[x, y]


def _splat_from_intensity(
    x: int,
    y: int,
    z: int,
    intensity: float,
    params: SplatConversionParams,
    *,
    segment_id: int | None = None,
) -> SplatPrimitive | None:
    tf = params.transfer_function
    if intensity < tf.threshold:
        return None
    normalized = max(
        0.0,
        min(
            1.0, (intensity - tf.intensity_min) / (tf.intensity_max - tf.intensity_min)
        ),
    )
    opacity = tf.opacity_min + normalized * (tf.opacity_max - tf.opacity_min)
    if tf.color_map == "hot":
        red, green, blue = 255, int(255 * normalized), int(96 * normalized)
    else:
        value = int(round(255 * normalized))
        red = green = blue = value
    return SplatPrimitive(
        float(x),
        float(y),
        float(z),
        float(params.downsample),
        float(opacity),
        red,
        green,
        blue,
        intensity,
        segment_id,
    )


def _write_ply(path: Path, splats: Sequence[SplatPrimitive]) -> None:
    with path.open("w", encoding="utf-8") as file_obj:
        file_obj.write("ply\nformat ascii 1.0\n")
        file_obj.write(f"element vertex {len(splats)}\n")
        for field in ("x", "y", "z", "scale", "opacity"):
            file_obj.write(f"property float {field}\n")
        for field in ("red", "green", "blue"):
            file_obj.write(f"property uchar {field}\n")
        file_obj.write("property uchar segment_id\n")
        file_obj.write("end_header\n")
        for splat in splats:
            file_obj.write(
                f"{splat.x} {splat.y} {splat.z} {splat.scale} {splat.opacity:.6f} "
                f"{splat.red} {splat.green} {splat.blue} {splat.segment_id or 0}\n"
            )


def _write_asset_atomically(path: Path, writer: Callable[[Path], None]) -> None:
    temporary_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        writer(temporary_path)
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _write_json(
    path: Path,
    splats: Sequence[SplatPrimitive],
    metadata: dict[str, Any],
    *,
    include_splats: bool,
) -> None:
    payload = {"metadata": metadata}
    if include_splats:
        payload["splats"] = [asdict(splat) for splat in splats]
    path.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")


def _cached_splat_count(path: Path) -> int:
    if path.suffix == ".ply":
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("element vertex "):
                return int(line.rsplit(" ", 1)[-1])
    payload = json.loads(path.read_text(encoding="utf-8"))
    return int(
        payload.get("metadata", {}).get("splat_count") or len(payload.get("splats", []))
    )


def _metadata(
    volume_info,
    volume_stack_id,
    source_image_ids,
    params,
    cache_key,
    splat_count,
    segmentation_present=False,
):
    return {
        "asset_type": "gaussian_splat",
        "volume_stack_id": volume_stack_id,
        "source_image_ids": list(source_image_ids or []),
        "dimensions": list(volume_info.shape),
        # Public assets retain useful provenance names without exposing the
        # server's cache layout.
        "source_files": [Path(item).name for item in volume_info.source_files],
        "cache_key": cache_key,
        "conversion_parameters": asdict(params),
        "splat_count": splat_count,
        "segmentation_present": bool(segmentation_present),
        "sampling_policy": (
            {
                "name": "segment_stratified_proportional_v1",
                "unsegmented_bucket": "segment_id null in JSON and 0 in PLY",
                "undersized_budget": "largest buckets first; ties use first occurrence",
            }
            if segmentation_present
            else {"name": "global_stride_v1"}
        ),
    }
