"""Generate static Abyss/Paper favicons matching js/favicon.js canvas paint."""
from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "logo-assets")
ROOT = os.path.abspath(ROOT)
O_PATH = os.path.join(ROOT, "favicon-o.png")
o_img = Image.open(O_PATH).convert("RGBA")


def paint(size, bg_hex, accent_hex, circular=False):
    bg = tuple(int(bg_hex[i : i + 2], 16) for i in (1, 3, 5)) + (255,)
    accent = tuple(int(accent_hex[i : i + 2], 16) for i in (1, 3, 5)) + (255,)

    # Scale geometry from the 64px canvas in favicon.js
    scale = size / 64.0
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    if circular:
        draw.ellipse([0, 0, size - 1, size - 1], fill=bg)
    else:
        draw.rectangle([0, 0, size - 1, size - 1], fill=bg)

    o_size = int(round(20 * scale))
    stroke = max(3, int(round(o_size * (6 / 32))))
    gap = max(2, int(round(o_size * (3 / 98))))
    caret_w = o_size
    caret_h = stroke
    below_gap = max(2, int(round(o_size * 0.14)))
    total_w = o_size + gap + caret_w
    total_h = o_size + below_gap + caret_h
    start_x = int(round((size - total_w) / 2))
    o_y = int(round((size - total_h) / 2))

    o_resized = o_img.resize((o_size, o_size), Image.Resampling.NEAREST)
    alpha = o_resized.split()[3]
    red_sil = Image.new("RGBA", (o_size, o_size), (255, 51, 68, 255))
    red_sil.putalpha(alpha)

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for blur_r, opacity in ((int(10 * scale), 180), (int(4 * scale), 220)):
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        layer.paste(red_sil, (start_x, o_y), red_sil)
        if blur_r > 0:
            layer = layer.filter(ImageFilter.GaussianBlur(radius=max(1, blur_r / 2)))
        a = layer.split()[3].point(lambda p, op=opacity: int(p * op / 255))
        layer.putalpha(a)
        glow = Image.alpha_composite(glow, layer)

    canvas = Image.alpha_composite(canvas, glow)
    canvas.paste(o_resized, (start_x, o_y), o_resized)

    caret_x = start_x + o_size + gap
    caret_y = o_y + o_size + below_gap

    caret_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cd = ImageDraw.Draw(caret_layer)
    cd.rectangle(
        [caret_x, caret_y, caret_x + caret_w - 1, caret_y + caret_h - 1],
        fill=accent,
    )

    for blur_r, opacity in ((int(12 * scale), 160), (int(5 * scale), 200)):
        glow_c = caret_layer.filter(ImageFilter.GaussianBlur(radius=max(1, blur_r / 2)))
        a = glow_c.split()[3].point(lambda p, op=opacity: int(p * op / 255))
        glow_c.putalpha(a)
        canvas = Image.alpha_composite(canvas, glow_c)

    canvas = Image.alpha_composite(canvas, caret_layer)

    if circular:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(canvas, (0, 0), mask)
        return out
    return canvas


def main():
    # Opaque squares — Google applies its own circular crop in SERPs
    for name, bg, accent in (
        ("abyss", "#000000", "#ffffff"),
        ("paper", "#ffffff", "#000000"),
    ):
        img96 = paint(96, bg, accent, circular=False)
        path96 = os.path.join(ROOT, f"favicon-{name}.png")
        img96.save(path96, "PNG")
        print("wrote", path96, img96.size)

        img512 = paint(512, bg, accent, circular=False)
        path512 = os.path.join(ROOT, f"favicon-{name}-512.png")
        img512.save(path512, "PNG")
        print("wrote", path512, img512.size)

        img180 = paint(180, bg, accent, circular=False)
        path180 = os.path.join(ROOT, f"apple-touch-{name}.png")
        img180.save(path180, "PNG")
        print("wrote", path180, img180.size)


if __name__ == "__main__":
    main()
