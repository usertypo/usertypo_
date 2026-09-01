"""Generate circular crawlable favicons from logo-assets/blah-abyss.png and blah-paper.png."""
from PIL import Image, ImageDraw
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "logo-assets")
ROOT = os.path.abspath(ROOT)
SOURCES = {
    "abyss": (os.path.join(ROOT, "blah-abyss.png"), (0, 0, 0, 255)),
    "paper": (os.path.join(ROOT, "blah-paper.png"), (255, 255, 255, 255)),
}

# Keep in sync with js/favicon.js CONTENT_ZOOM
CONTENT_ZOOM = 1.3


def circular_icon(src: Image.Image, size: int, bg_rgba: tuple) -> Image.Image:
    out = Image.new("RGBA", (size, size), bg_rgba)
    draw_size = round(size * CONTENT_ZOOM)
    img = src.resize((draw_size, draw_size), Image.Resampling.LANCZOS).convert("RGBA")
    offset = (size - draw_size) // 2
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.paste(img, (offset, offset), img)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    out.paste(layer, (0, 0), mask)
    return out


def main():
    for name, (path, bg) in SOURCES.items():
        if not os.path.isfile(path):
            raise SystemExit(f"missing source: {path}")
        src = Image.open(path)

        img96 = circular_icon(src, 96, bg)
        path96 = os.path.join(ROOT, f"favicon-{name}.png")
        img96.save(path96, "PNG")
        print("wrote", path96, img96.size)

        img512 = circular_icon(src, 512, bg)
        path512 = os.path.join(ROOT, f"favicon-{name}-512.png")
        img512.save(path512, "PNG")
        print("wrote", path512, img512.size)

        img180 = circular_icon(src, 180, bg)
        path180 = os.path.join(ROOT, f"apple-touch-{name}.png")
        img180.save(path180, "PNG")
        print("wrote", path180, img180.size)


if __name__ == "__main__":
    main()
