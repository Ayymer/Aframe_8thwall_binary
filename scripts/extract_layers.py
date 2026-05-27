#!/usr/bin/env python3
"""Extract feathered PNG layers from the Ruysch painting for AR animation."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "Targets" / "painting.png"
OUT_DIR = ROOT / "assets" / "layers"
META_DIR = ROOT / "assets" / "meta"

IMG_W = 809
IMG_H = 1024
TARGET_W = 0.809
TARGET_H = 1.024
MAX_LONG_EDGE = 512
PADDING = 12
FEATHER = 5

# Polygons in full-image pixel coords (x, y), top-left origin.
# Masks include a dark halo so edges blend into the canvas.
LAYERS = [
    {
        "id": "iris",
        "polygon": [
            (40, 260), (120, 220), (200, 250), (230, 320), (210, 420),
            (140, 450), (70, 400), (35, 330),
        ],
        "anchor": (120, 420),
        "zOrder": 0,
        "emergeDelayMs": 400,
        "wiltDelayMs": 0,
        "swayFreq": 0.25,
        "swayAmp": 0.8,
    },
    {
        "id": "rosebuds",
        "polygon": [
            (110, 490), (170, 470), (220, 500), (235, 550), (210, 590),
            (150, 600), (100, 560), (95, 510),
        ],
        "anchor": (155, 585),
        "zOrder": 1,
        "emergeDelayMs": 800,
        "wiltDelayMs": 1200,
        "swayFreq": 0.35,
        "swayAmp": 1.0,
    },
    {
        "id": "rose-white",
        "polygon": [
            (160, 400), (240, 380), (310, 420), (320, 490), (280, 540),
            (200, 530), (150, 480), (145, 430),
        ],
        "anchor": (210, 525),
        "zOrder": 2,
        "emergeDelayMs": 1400,
        "wiltDelayMs": 1800,
        "swayFreq": 0.3,
        "swayAmp": 1.1,
    },
    {
        "id": "butterfly",
        "polygon": [
            (115, 365), (155, 350), (195, 370), (185, 410), (145, 420),
            (105, 395),
        ],
        "anchor": (150, 405),
        "zOrder": 8,
        "emergeDelayMs": 0,
        "wiltDelayMs": 0,
        "swayFreq": 2.5,
        "swayAmp": 4.0,
        "bloomOnly": True,
    },
    {
        "id": "marigold",
        "polygon": [
            (210, 470), (270, 455), (330, 490), (340, 550), (300, 590),
            (230, 580), (195, 530), (200, 490),
        ],
        "anchor": (265, 575),
        "zOrder": 3,
        "emergeDelayMs": 2000,
        "wiltDelayMs": 2400,
        "swayFreq": 0.32,
        "swayAmp": 1.0,
    },
    {
        "id": "rose-pink",
        "polygon": [
            (320, 430), (400, 410), (490, 450), (510, 530), (470, 610),
            (380, 620), (310, 580), (300, 490),
        ],
        "anchor": (395, 605),
        "zOrder": 4,
        "emergeDelayMs": 2600,
        "wiltDelayMs": 3000,
        "swayFreq": 0.28,
        "swayAmp": 1.2,
    },
    {
        "id": "hydrangea",
        "polygon": [
            (260, 590), (340, 570), (450, 590), (480, 660), (440, 730),
            (340, 740), (270, 700), (250, 640),
        ],
        "anchor": (365, 725),
        "zOrder": 5,
        "emergeDelayMs": 3200,
        "wiltDelayMs": 3600,
        "swayFreq": 0.22,
        "swayAmp": 0.7,
    },
    {
        "id": "poppy",
        "polygon": [
            (390, 30), (460, 20), (530, 55), (550, 120), (510, 190),
            (440, 185), (380, 140), (375, 70),
        ],
        "anchor": (455, 175),
        "zOrder": 6,
        "emergeDelayMs": 4800,
        "wiltDelayMs": 0,
        "swayFreq": 0.2,
        "swayAmp": 0.9,
    },
    {
        "id": "tulip",
        "polygon": [
            (350, 130), (420, 110), (490, 150), (505, 230), (470, 310),
            (410, 300), (355, 250), (340, 180),
        ],
        "anchor": (430, 295),
        "zOrder": 7,
        "emergeDelayMs": 5400,
        "wiltDelayMs": 600,
        "swayFreq": 0.18,
        "swayAmp": 0.8,
    },
    {
        "id": "sunflower",
        "polygon": [
            (500, 680), (580, 650), (680, 680), (730, 760), (710, 870),
            (620, 920), (530, 900), (490, 820), (480, 740),
        ],
        "anchor": (545, 895),
        "zOrder": 9,
        "emergeDelayMs": 0,
        "wiltDelayMs": 8000,
        "swayFreq": 0.45,
        "swayAmp": 1.5,
    },
]


def polygon_bbox(points: list[tuple[int, int]]) -> tuple[int, int, int, int]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def extract_layer(source: Image.Image, layer: dict) -> dict:
    polygon = layer["polygon"]
    anchor = layer["anchor"]
    left, top, right, bottom = polygon_bbox(polygon)
    left = max(0, left - PADDING)
    top = max(0, top - PADDING)
    right = min(IMG_W, right + PADDING)
    bottom = min(IMG_H, bottom + PADDING)
    crop_w = right - left
    crop_h = bottom - top

    local_poly = [(x - left, y - top) for x, y in polygon]

    mask = Image.new("L", (crop_w, crop_h), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon(local_poly, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(FEATHER))

    crop = source.crop((left, top, right, bottom))
    rgba = crop.convert("RGBA")
    rgba.putalpha(mask)

    long_edge = max(crop_w, crop_h)
    scale = 1.0
    if long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / long_edge
        new_w = max(1, int(crop_w * scale))
        new_h = max(1, int(crop_h * scale))
        rgba = rgba.resize((new_w, new_h), Image.Resampling.LANCZOS)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{layer['id']}.png"
    rgba.save(out_path, optimize=True)

    center_x = left + crop_w / 2
    center_y = top + crop_h / 2

    entry = {
        "id": layer["id"],
        "src": f"assets/layers/{layer['id']}.png",
        "anchorPx": list(anchor),
        "centerPx": [round(center_x, 2), round(center_y, 2)],
        "sizePx": [crop_w, crop_h],
        "cropRect": [left, top, crop_w, crop_h],
        "zOrder": layer["zOrder"],
        "emergeDelayMs": layer["emergeDelayMs"],
        "wiltDelayMs": layer["wiltDelayMs"],
        "swayFreq": layer["swayFreq"],
        "swayAmp": layer["swayAmp"],
    }
    if layer.get("bloomOnly"):
        entry["bloomOnly"] = True
    return entry


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    if source.size != (IMG_W, IMG_H):
        raise SystemExit(f"Expected {IMG_W}x{IMG_H}, got {source.size}")

    layer_entries = [extract_layer(source, layer) for layer in LAYERS]
    layer_entries.sort(key=lambda item: item["zOrder"])

    config = {
        "targetWidth": TARGET_W,
        "targetHeight": TARGET_H,
        "loopDurationMs": 30000,
        "phases": {
            "stillMs": 3000,
            "emergeMs": 9000,
            "bloomMs": 8000,
            "wiltMs": 10000,
        },
        "layers": layer_entries,
    }

    META_DIR.mkdir(parents=True, exist_ok=True)
    meta_path = META_DIR / "layers.json"
    meta_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")

    total_bytes = sum((OUT_DIR / f"{layer['id']}.png").stat().st_size for layer in LAYERS)
    print(f"Exported {len(LAYERS)} layers to {OUT_DIR}")
    print(f"Config written to {meta_path}")
    print(f"Total layer size: {total_bytes / 1024:.1f} KB")


if __name__ == "__main__":
    main()
