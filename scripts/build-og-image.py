"""Build og-image.png from real header logo layers (Abyss theme) + JetBrains Mono tagline."""
from __future__ import annotations

import io
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "logo-assets"
OUT = ROOT / "og-image.png"

# Abyss theme (settings.js THEME_PALETTES['Abyss'] + logo mapping)
BG = (0, 0, 0, 255)
TYP_COLOR = (255, 255, 255, 255)       # accentPrimary
USER_COLOR = (204, 204, 204, 255)      # textPrimary (#cccccc)
TAGLINE = "Free Typing Platform"
OG_W, OG_H = 1200, 630


def mask_layer(path: Path, color: tuple[int, int, int, int]) -> Image.Image:
    src = Image.open(path).convert("RGBA")
    # Build alpha from luminance (CSS mask-image behavior for opaque logos)
    gray = src.convert("L")
    r, g, b, a = color
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    pixels = out.load()
    gpix = gray.load()
    for y in range(src.size[1]):
        for x in range(src.size[0]):
            v = gpix[x, y]
            if v > 8:
                pixels[x, y] = (r, g, b, min(255, int(v * (a / 255.0) * 9)))  # boost palette values
    return out


def tint_from_luminance_fast(path: Path, color: tuple[int, int, int, int]) -> Image.Image:
    src = Image.open(path).convert("RGBA")
    gray = src.convert("L")
    # Normalize palette-ish low values up to full mask strength
    gray = gray.point(lambda v: 255 if v > 4 else 0)
    colored = Image.new("RGBA", src.size, color)
    colored.putalpha(gray)
    return colored


def keep_colored(path: Path) -> Image.Image:
    src = Image.open(path).convert("RGBA")
    # Drop near-black background; keep logo glyphs
    datas = src.getdata()
    out = []
    for r, g, b, a in datas:
        if r + g + b < 20:
            out.append((0, 0, 0, 0))
        else:
            out.append((r, g, b, 255))
    src.putdata(out)
    return src


def soft_glow(layer: Image.Image, color: tuple[int, int, int], radius: int = 12) -> Image.Image:
    alpha = layer.split()[-1]
    glow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    glow_color = Image.new("RGBA", layer.size, color + (180,))
    glow_color.putalpha(alpha)
    glow_color = glow_color.filter(ImageFilter.GaussianBlur(radius=radius))
    return glow_color


def download_jetbrains_mono() -> Path:
    fonts_dir = ROOT / "scripts" / ".fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    ttf = fonts_dir / "JetBrainsMono-Regular.ttf"
    if ttf.exists():
        return ttf
    url = "https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip"
    print("Downloading JetBrains Mono...")
    data = urllib.request.urlopen(url, timeout=60).read()
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        member = next(
            n for n in zf.namelist()
            if n.endswith("fonts/ttf/JetBrainsMono-Regular.ttf")
            or n.endswith("JetBrainsMono-Regular.ttf")
        )
        ttf.write_bytes(zf.read(member))
    return ttf


def main() -> None:
    typ = tint_from_luminance_fast(ASSETS / "typ_.png", TYP_COLOR)
    user = tint_from_luminance_fast(ASSETS / "user.png", USER_COLOR)
    o = keep_colored(ASSETS / "o.png")

    canvas = Image.new("RGBA", (2000, 2000), (0, 0, 0, 0))
    # Glows (subtle, matching header)
    canvas.alpha_composite(soft_glow(typ, (255, 255, 255), 14))
    canvas.alpha_composite(soft_glow(user, (204, 204, 204), 10))
    canvas.alpha_composite(soft_glow(o, (255, 51, 68), 12))
    # Layers: user under typ under o (same stacking as header)
    canvas.alpha_composite(user)
    canvas.alpha_composite(typ)
    canvas.alpha_composite(o)

    bbox = canvas.getbbox()
    if not bbox:
        raise SystemExit("Logo composite was empty")
    logo = canvas.crop(bbox)

    # Target logo width on OG canvas
    target_logo_w = 720
    scale = target_logo_w / logo.width
    logo_w = int(logo.width * scale)
    logo_h = int(logo.height * scale)
    logo = logo.resize((logo_w, logo_h), Image.Resampling.NEAREST)

    font_path = download_jetbrains_mono()
    font = ImageFont.truetype(str(font_path), 36)

    og = Image.new("RGBA", (OG_W, OG_H), BG)
    draw = ImageDraw.Draw(og)
    # Measure tagline
    tb = draw.textbbox((0, 0), TAGLINE, font=font)
    text_w = tb[2] - tb[0]
    text_h = tb[3] - tb[1]

    gap = 28
    block_h = logo_h + gap + text_h
    top = (OG_H - block_h) // 2
    logo_x = (OG_W - logo_w) // 2
    logo_y = top
    text_x = (OG_W - text_w) // 2
    text_y = logo_y + logo_h + gap

    og.alpha_composite(logo, (logo_x, logo_y))
    draw.text((text_x, text_y), TAGLINE, font=font, fill=(204, 204, 204, 255))

    # Flatten to RGB PNG for max OG compatibility
    final = Image.new("RGB", (OG_W, OG_H), (0, 0, 0))
    final.paste(og, mask=og.split()[-1])
    final.save(OUT, format="PNG", optimize=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
