#!/usr/bin/env python3
"""Generate images using Replicate's text-to-image models.

Reads REPLICATE_API_TOKEN from the .env file in the project root.
Saves generated images to tmp/generated_images/ (git-ignored).

Supported models:
  stable-diffusion  - Stability AI Stable Diffusion (default)
  p-image           - Pruna AI P-Image (sub-1s generation)

If no prompt or --prompts-file is given, reads from scripts/image_prompt.md by default.

Usage:
    python scripts/generate_images.py                              # uses scripts/image_prompt.md
    python scripts/generate_images.py "a cat wearing a top hat"
    python scripts/generate_images.py "sunset over mountains" --count 3
    python scripts/generate_images.py "pixel art castle" --width 768 --height 768
    python scripts/generate_images.py --model p-image "a blue whale underwater"
    python scripts/generate_images.py --model p-image "flowers in a vase" --aspect-ratio 16:9
    python scripts/generate_images.py --prompts-file prompts.txt
"""

import argparse
import os
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = Path(__file__).resolve().parent
TMP_DIR = PROJECT_ROOT / "tmp" / "generated_images"
DEFAULT_PROMPTS_FILE = SCRIPTS_DIR / "image_prompt.md"

MODELS = {
    "stable-diffusion": "stability-ai/sdxl",
    "p-image": "prunaai/p-image",
}


def load_env():
    """Load REPLICATE_API_TOKEN from .env file."""
    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = value

    token = os.environ.get("REPLICATE_API_TOKEN")
    if not token:
        print("Error: REPLICATE_API_TOKEN not set.")
        print("Add it to your .env file: REPLICATE_API_TOKEN=r8_...")
        sys.exit(1)
    return token


def _get_replicate():
    """Import and return the replicate module."""
    try:
        import replicate
        return replicate
    except ImportError:
        print("Error: replicate package not installed.")
        print("Install it with: pip install replicate")
        sys.exit(1)


def generate_stable_diffusion(prompt, count=1, width=512, height=512,
                               guidance_scale=7.5, num_inference_steps=50,
                               negative_prompt=None, scheduler=None,
                               seed=None):
    """Generate images via Stable Diffusion on Replicate."""
    replicate = _get_replicate()

    input_params = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_outputs": count,
        "guidance_scale": guidance_scale,
        "num_inference_steps": num_inference_steps,
    }
    if negative_prompt:
        input_params["negative_prompt"] = negative_prompt
    if scheduler:
        input_params["scheduler"] = scheduler
    if seed is not None:
        input_params["seed"] = seed

    print(f"Generating {count} image(s) for: \"{prompt}\"")
    print(f"  Model: stable-diffusion")
    print(f"  Size: {width}x{height}, steps: {num_inference_steps}, "
          f"guidance: {guidance_scale}")

    output = replicate.run(MODELS["stable-diffusion"], input=input_params)
    return list(output)


def generate_p_image(prompt, count=1, aspect_ratio=None, width=None,
                     height=None, prompt_upsampling=False, seed=None,
                     disable_safety_checker=False, lora_weights=None,
                     lora_scale=None, hf_api_token=None):
    """Generate images via Pruna AI P-Image on Replicate."""
    replicate = _get_replicate()

    input_params = {"prompt": prompt}
    if aspect_ratio:
        input_params["aspect_ratio"] = aspect_ratio
    if width is not None:
        input_params["width"] = width
    if height is not None:
        input_params["height"] = height
    if prompt_upsampling:
        input_params["prompt_upsampling"] = True
    if seed is not None:
        input_params["seed"] = seed
    if disable_safety_checker:
        input_params["disable_safety_checker"] = True
    if lora_weights:
        input_params["lora_weights"] = lora_weights
    if lora_scale is not None:
        input_params["lora_scale"] = lora_scale
    if hf_api_token:
        input_params["hf_api_token"] = hf_api_token

    size_info = f"{width}x{height}" if width and height else (
        aspect_ratio or "default"
    )
    print(f"Generating {count} image(s) for: \"{prompt}\"")
    print(f"  Model: p-image")
    print(f"  Size: {size_info}")

    results = []
    for i in range(count):
        if count > 1:
            print(f"  [{i + 1}/{count}]", end=" ", flush=True)
        output = replicate.run(MODELS["p-image"], input=input_params)
        # p-image returns a single FileOutput, not a list
        results.append(output)
        if count > 1:
            print("done")
    return results


def download_image(url, dest_path):
    """Download an image from a URL to a local path."""
    import urllib.request
    urllib.request.urlretrieve(url, dest_path)


def _detect_ext(item):
    """Detect image extension from a URL or FileOutput."""
    url_str = str(getattr(item, "url", item)).lower()
    if ".jpeg" in url_str or ".jpg" in url_str:
        return "jpeg"
    if ".webp" in url_str:
        return "webp"
    return "png"


def save_images(outputs, prompt, model_name="stable-diffusion"):
    """Save generated images to the tmp directory.

    Handles Replicate FileOutput objects (with .read()) and plain URL strings.
    """
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    safe_prompt = "".join(c if c.isalnum() or c in " -_" else "" for c in prompt)
    safe_prompt = safe_prompt.strip().replace(" ", "_")[:60]

    ext = _detect_ext(outputs[0]) if outputs else "png"

    saved = []
    for i, item in enumerate(outputs):
        filename = f"{timestamp}_{model_name}_{safe_prompt}_{i}.{ext}"
        dest = TMP_DIR / filename
        print(f"  Saving: {filename}")

        if hasattr(item, "read"):
            # Replicate FileOutput -- read bytes directly
            with open(dest, "wb") as f:
                f.write(item.read())
        elif isinstance(item, str):
            # Plain URL string
            download_image(item, str(dest))
        else:
            # Fallback: write raw bytes
            dest.write_bytes(bytes(item))

        saved.append(dest)

    return saved


def main():
    parser = argparse.ArgumentParser(
        description="Generate images using text-to-image models via Replicate",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Supported models:
  stable-diffusion  Stability AI Stable Diffusion (default)
                    - Supports --count, --width (mult of 64), --height (mult of 64),
                      --guidance-scale, --steps, --negative-prompt, --scheduler
  p-image           Pruna AI P-Image (sub-1s generation)
                    - Supports --aspect-ratio, --width (mult of 16), --height (mult of 16),
                      --prompt-upsampling, --lora-weights, --lora-scale,
                      --disable-safety-checker

Examples:
  %(prog)s "a cat wearing a top hat"
  %(prog)s "sunset over mountains" --count 3
  %(prog)s --model p-image "flowers in a vase" --aspect-ratio 16:9
  %(prog)s --model p-image "pixel art" --width 1024 --height 576
  %(prog)s --prompts-file prompts.txt
""",
    )
    parser.add_argument("prompt", nargs="?", help="Text prompt for image generation")
    parser.add_argument("--prompts-file", help="File with one prompt per line")
    parser.add_argument("--model", "-m", choices=list(MODELS.keys()),
                        default="stable-diffusion",
                        help="Model to use (default: stable-diffusion)")
    parser.add_argument("--seed", type=int, help="Random seed for reproducibility")

    # Stable Diffusion options
    sd_group = parser.add_argument_group("Stable Diffusion options")
    sd_group.add_argument("--count", "-n", type=int, default=1,
                          help="Number of images per prompt (default: 1)")
    sd_group.add_argument("--width", "-W", type=int,
                          help="Image width in pixels (default: 512 for SD, custom for p-image)")
    sd_group.add_argument("--height", "-H", type=int,
                          help="Image height in pixels (default: 512 for SD, custom for p-image)")
    sd_group.add_argument("--guidance-scale", "-g", type=float, default=7.5,
                          help="Classifier-free guidance scale (default: 7.5)")
    sd_group.add_argument("--steps", "-s", type=int, default=50,
                          help="Number of inference steps (default: 50)")
    sd_group.add_argument("--negative-prompt",
                          help="Things to exclude from the image")
    sd_group.add_argument("--scheduler", choices=[
        "DDIM", "K_EULER", "DPMSolverMultistep", "K_EULER_ANCESTRAL",
        "PNDM", "K-LMS"
    ], help="Diffusion scheduler")

    # P-Image options
    pi_group = parser.add_argument_group("P-Image options")
    pi_group.add_argument("--aspect-ratio", choices=[
        "1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21", "custom"
    ], help="Aspect ratio (use 'custom' with --width/--height)")
    pi_group.add_argument("--prompt-upsampling", action="store_true",
                          help="Upsample the prompt with an LLM")
    pi_group.add_argument("--disable-safety-checker", action="store_true",
                          help="Disable safety checker for generated images")
    pi_group.add_argument("--lora-weights",
                          help="HuggingFace LoRA weights URL")
    pi_group.add_argument("--lora-scale", type=float,
                          help="LoRA strength (0.5 works well for most)")
    pi_group.add_argument("--hf-api-token",
                          help="HuggingFace API token for private LoRAs")

    args = parser.parse_args()

    # Default to scripts/image_prompt.md when no prompt or file given
    if not args.prompt and not args.prompts_file:
        if DEFAULT_PROMPTS_FILE.exists():
            args.prompts_file = str(DEFAULT_PROMPTS_FILE)
            print(f"No prompt given, using default: {DEFAULT_PROMPTS_FILE}")
        else:
            parser.error(
                "Provide a prompt, --prompts-file, or create "
                "scripts/image_prompt.md"
            )

    # Validate dimensions based on model
    if args.model == "stable-diffusion":
        w = args.width or 512
        h = args.height or 512
        if w % 64 != 0:
            parser.error("Width must be a multiple of 64 for stable-diffusion")
        if h % 64 != 0:
            parser.error("Height must be a multiple of 64 for stable-diffusion")
    elif args.model == "p-image":
        if args.width and args.width % 16 != 0:
            parser.error("Width must be a multiple of 16 for p-image")
        if args.height and args.height % 16 != 0:
            parser.error("Height must be a multiple of 16 for p-image")

    load_env()

    prompts = []
    if args.prompts_file:
        prompts_path = Path(args.prompts_file)
        if not prompts_path.exists():
            print(f"Error: prompts file not found: {args.prompts_file}")
            sys.exit(1)
        prompts = [
            line.strip() for line in prompts_path.read_text().splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
    if args.prompt:
        prompts.append(args.prompt)

    if not prompts:
        print("Error: no prompts provided")
        sys.exit(1)

    total_saved = []
    for prompt in prompts:
        if args.model == "stable-diffusion":
            urls = generate_stable_diffusion(
                prompt=prompt,
                count=args.count,
                width=args.width or 512,
                height=args.height or 512,
                guidance_scale=args.guidance_scale,
                num_inference_steps=args.steps,
                negative_prompt=args.negative_prompt,
                scheduler=args.scheduler,
                seed=args.seed,
            )
        elif args.model == "p-image":
            urls = generate_p_image(
                prompt=prompt,
                count=args.count,
                aspect_ratio=args.aspect_ratio,
                width=args.width,
                height=args.height,
                prompt_upsampling=args.prompt_upsampling,
                seed=args.seed,
                disable_safety_checker=args.disable_safety_checker,
                lora_weights=args.lora_weights,
                lora_scale=args.lora_scale,
                hf_api_token=args.hf_api_token,
            )

        saved = save_images(urls, prompt, model_name=args.model)
        total_saved.extend(saved)

    print(f"\nDone. {len(total_saved)} image(s) saved to {TMP_DIR}/")
    for p in total_saved:
        print(f"  {p}")


if __name__ == "__main__":
    main()
