"""Pure-Pillow image operations used by Analyze workflow method handlers."""

import math
from collections import deque
from typing import Any

from PIL import Image, ImageChops, ImageFilter, ImageOps


def grayscale(image: Image.Image) -> Image.Image:
    return ImageOps.grayscale(image)


def window_level(
    image: Image.Image, window: float, level: float, clip: bool
) -> Image.Image:
    low = level - (window / 2.0)
    high = level + (window / 2.0)
    scale = 255.0 / max(high - low, 1.0)

    def map_pixel(value: int) -> int:
        mapped = int(round((float(value) - low) * scale))
        if clip:
            return max(0, min(255, mapped))
        return mapped % 256

    if image.mode in ("RGB", "RGBA"):
        channels = image.split()
        normalized_channels = [channels[idx].point(map_pixel) for idx in range(3)]
        if image.mode == "RGBA":
            normalized_channels.append(channels[3])
        return Image.merge(image.mode, tuple(normalized_channels))

    gray = grayscale(image)
    return gray.point(map_pixel)


def minmax(image: Image.Image, output_min: float, output_max: float) -> Image.Image:
    def normalize_channel(channel: Image.Image) -> Image.Image:
        min_value, max_value = channel.getextrema()
        if max_value <= min_value:
            return Image.new("L", channel.size, int(max(0, min(255, output_min * 255))))
        scale = (output_max - output_min) / float(max_value - min_value)

        def map_pixel(value: int) -> int:
            mapped = (output_min + ((value - min_value) * scale)) * 255.0
            return max(0, min(255, int(round(mapped))))

        return channel.point(map_pixel)

    if image.mode in ("RGB", "RGBA"):
        channels = image.split()
        normalized_channels = [normalize_channel(channels[idx]) for idx in range(3)]
        if image.mode == "RGBA":
            normalized_channels.append(channels[3])
        return Image.merge(image.mode, tuple(normalized_channels))

    gray = grayscale(image)
    return normalize_channel(gray)


def otsu_threshold(image: Image.Image) -> tuple[Image.Image, int]:
    gray = grayscale(image)
    hist = gray.histogram()
    total = sum(hist)
    sum_total = sum(level * count for level, count in enumerate(hist))
    sum_background = 0.0
    weight_background = 0
    best_variance = -1.0
    threshold = 0
    for level, count in enumerate(hist):
        weight_background += count
        if weight_background == 0:
            continue
        weight_foreground = total - weight_background
        if weight_foreground == 0:
            break
        sum_background += level * count
        mean_background = sum_background / weight_background
        mean_foreground = (sum_total - sum_background) / weight_foreground
        variance = (
            weight_background
            * weight_foreground
            * ((mean_background - mean_foreground) ** 2)
        )
        if variance > best_variance:
            best_variance = variance
            threshold = level
    return gray.point(lambda value: 255 if value > threshold else 0), threshold


def manual_threshold(image: Image.Image, threshold: float, invert: bool) -> Image.Image:
    gray = grayscale(image)
    cutoff = threshold * 255.0 if threshold <= 1.0 else threshold
    if invert:
        return gray.point(lambda value: 255 if value < cutoff else 0)
    return gray.point(lambda value: 255 if value >= cutoff else 0)


def connected_components(
    mask: Image.Image, min_area_px: int = 0
) -> tuple[Image.Image, list[dict[str, Any]]]:
    binary = grayscale(mask).point(lambda value: 1 if value > 0 else 0)
    width, height = binary.size
    pixels = binary.load()
    labels = Image.new("L", binary.size, 0)
    label_pixels = labels.load()
    visited = set()
    measurements: list[dict[str, Any]] = []
    label_value = 1

    for y in range(height):
        for x in range(width):
            if (x, y) in visited or pixels[x, y] == 0:
                continue
            queue = deque([(x, y)])
            visited.add((x, y))
            points = []
            while queue:
                px, py = queue.popleft()
                points.append((px, py))
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    if (nx, ny) in visited or pixels[nx, ny] == 0:
                        continue
                    visited.add((nx, ny))
                    queue.append((nx, ny))
            if len(points) < min_area_px:
                continue
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            stored_label = ((label_value - 1) % 254) + 1
            for px, py in points:
                label_pixels[px, py] = stored_label
            measurements.append(
                {
                    "label": label_value,
                    "area_px": len(points),
                    "bbox": [min(xs), min(ys), max(xs) + 1, max(ys) + 1],
                    "centroid": [sum(xs) / len(points), sum(ys) / len(points)],
                }
            )
            label_value += 1
    return labels, measurements


def seeded_regions(image: Image.Image, seed_spacing_px: int) -> Image.Image:
    gray = grayscale(image)
    width, height = gray.size
    spacing = max(1, int(seed_spacing_px))
    labels = Image.new("L", gray.size, 0)
    label_pixels = labels.load()
    for y in range(height):
        for x in range(width):
            grid_x = x // spacing
            grid_y = y // spacing
            label_pixels[x, y] = (
                (grid_y * max(1, math.ceil(width / spacing)) + grid_x) % 254
            ) + 1
    return labels


def edge_mask(
    image: Image.Image, low_threshold: float, high_threshold: float
) -> Image.Image:
    edges = grayscale(image).filter(ImageFilter.FIND_EDGES)
    cutoff = max(low_threshold, high_threshold)
    cutoff = cutoff * 255.0 if cutoff <= 1.0 else cutoff
    return edges.point(lambda value: 255 if value >= cutoff else 0)


def asphalt_anomaly_heatmap(
    image: Image.Image, sensitivity: float, blur_radius: int
) -> Image.Image:
    gray = grayscale(image)
    blurred = gray.filter(ImageFilter.GaussianBlur(radius=max(0, int(blur_radius))))
    edges = blurred.filter(ImageFilter.FIND_EDGES)
    hist = edges.histogram()
    total = sum(hist)
    target_ratio = 0.03 + ((1.0 - max(0.0, min(1.0, sensitivity))) * 0.2)
    target_pixels = max(1, int(total * target_ratio))
    running = 0
    threshold = 255
    for level in range(255, -1, -1):
        running += hist[level]
        if running >= target_pixels:
            threshold = level
            break
    binary = edges.point(
        lambda value: (
            255 if (value > 0 if threshold <= 0 else value >= threshold) else 0
        )
    )
    return binary.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MaxFilter(3))


def frangi_ridge_heatmap(
    image: Image.Image, sensitivity: float, blur_radius: int
) -> Image.Image:
    gray = grayscale(image).filter(
        ImageFilter.GaussianBlur(radius=max(0, int(blur_radius)))
    )
    inverted = ImageOps.invert(gray)
    fine = inverted.filter(ImageFilter.FIND_EDGES)
    coarse = inverted.filter(ImageFilter.GaussianBlur(radius=2)).filter(
        ImageFilter.FIND_EDGES
    )
    enhanced = Image.blend(coarse, fine, alpha=0.65)
    cutoff = int(255 * (0.75 - (max(0.0, min(1.0, sensitivity)) * 0.45)))
    return enhanced.point(lambda value: 255 if value >= cutoff else 0).filter(
        ImageFilter.MaxFilter(3)
    )


def blackhat_crack_heatmap(
    image: Image.Image, kernel_radius: int, sensitivity: float
) -> Image.Image:
    gray = grayscale(image)
    size = max(3, (int(kernel_radius) * 2) + 1)
    closed = gray.filter(ImageFilter.MaxFilter(size)).filter(
        ImageFilter.MinFilter(size)
    )
    blackhat = ImageChops.subtract(closed, gray)
    hist = blackhat.histogram()
    total = sum(hist)
    target_ratio = 0.025 + ((1.0 - max(0.0, min(1.0, sensitivity))) * 0.12)
    target_pixels = max(1, int(total * target_ratio))
    running = 0
    threshold = 255
    for level in range(255, -1, -1):
        running += hist[level]
        if running >= target_pixels:
            threshold = level
            break
    return blackhat.point(
        lambda value: (
            255 if (value > 0 if threshold <= 0 else value >= threshold) else 0
        )
    ).filter(ImageFilter.MaxFilter(3))


def mask_area_ratio(measurements: list[dict[str, Any]], image: Image.Image) -> float:
    total_pixels = max(1, image.width * image.height)
    return (
        sum(int(measurement.get("area_px", 0) or 0) for measurement in measurements)
        / total_pixels
    )


def largest_region_ratio(
    measurements: list[dict[str, Any]], image: Image.Image
) -> float:
    total_pixels = max(1, image.width * image.height)
    return (
        max(
            (int(measurement.get("area_px", 0) or 0) for measurement in measurements),
            default=0,
        )
        / total_pixels
    )


def morphology(mask: Image.Image, radius: int, operation: str) -> Image.Image:
    size = max(3, (int(radius) * 2) + 1)
    source = grayscale(mask)
    if operation == "open":
        return source.filter(ImageFilter.MinFilter(size)).filter(
            ImageFilter.MaxFilter(size)
        )
    return source.filter(ImageFilter.MaxFilter(size)).filter(
        ImageFilter.MinFilter(size)
    )


def summarize_image(image: Image.Image) -> dict[str, Any]:
    extrema = grayscale(image).getextrema()
    return {
        "size": list(image.size),
        "mode": image.mode,
        "intensity_range": list(extrema),
    }
