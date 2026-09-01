"""Generate static Abyss/Paper favicons matching js/favicon.js canvas paint."""
from PIL import Image, ImageDraw, ImageFilter
import os

ROOT = os.path.join(os.path.dirname(__file__), "..", "logo-assets")
ROOT = os.path.abspath(ROOT)
O_PATH = os.path.join(ROOT, "favicon-o.png")
USER_PATH = os.path.join(ROOT, "user.png")
o_img = Image.open(O_PATH).convert("RGBA")
user_img = Image.open(USER_PATH).convert("RGBA")


def layout(size: float) -> dict:
    s = size / 1024.0
    user_w = 474 * s
    user_h = 108 * s
    stack_gap = 29 * s
    o_size = 155 * s
    o_gap = 15 * s
    caret_w = 240 * s
    caret_h = 49 * s
    below_gap = 48 * s
    o_row_w = o_size + o_gap + caret_w
    o_row_h = o_size + below_gap + caret_h
    stack_h = user_h + stack_gap + o_row_h
    stack_top = (size - stack_h) / 2
    return {
        "user_x": (size - user_w) / 2,
        "user_y": stack_top,
        "user_w": user_w,
        "user_h": user_h,
        "o_x": (size - o_row_w) / 2,
        "o_y": stack_top + user_h + stack_gap,
        "o_size": o_size,
        "o_gap": o_gap,
        "caret_w": caret_w,
        "caret_h": caret_h,
        "below_gap": below_gap,
    }


def crop_alpha(img: Image.Image) -> Image.Image:
    bbox = img.split()[3].getbbox()
    if not bbox:
        return img
    return img.crop(bbox)


def tinted_mask(img: Image.Image, color: tuple, glow_radius: float) -> Image.Image:
    alpha = img.split()[3]
    tint = Image.new("RGBA", img.size, color)
    tint.putalpha(alpha)
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    for blur_r, opacity in ((glow_radius, 170), (glow_radius * 0.45, 210)):
        layer = tint.filter(ImageFilter.GaussianBlur(radius=max(1, blur_r / 2)))
        a = layer.split()[3].point(lambda p, op=opacity: int(p * op / 255))
        layer.putalpha(a)
        glow = Image.alpha_composite(glow, layer)
    return Image.alpha_composite(glow, tint)


def paint(size: int, bg_hex: str, accent_hex: str, circular: bool = False) -> Image.Image:
    bg = tuple(int(bg_hex[i : i + 2], 16) for i in (1, 3, 5)) + (255,)
    accent = tuple(int(accent_hex[i : i + 2], 16) for i in (1, 3, 5)) + (255,)

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    if circular:
        draw.ellipse([0, 0, size - 1, size - 1], fill=bg)
    else:
        draw.rectangle([0, 0, size - 1, size - 1], fill=bg)

    L = layout(size)

    user_crop = crop_alpha(user_img)
    user_w = max(1, int(round(L["user_w"])))
    user_h = max(1, int(round(L["user_h"])))
    user_scaled = user_crop.resize((user_w, user_h), Image.Resampling.NEAREST)
    user_tinted = tinted_mask(
        user_scaled,
        accent,
        max(2, L["user_h"] * 0.55),
    )
    canvas.alpha_composite(
        user_tinted,
        (int(round(L["user_x"])), int(round(L["user_y"]))),
    )

    o_size = max(1, int(round(L["o_size"])))
    o_x = int(round(L["o_x"]))
    o_y = int(round(L["o_y"]))
    o_resized = o_img.resize((o_size, o_size), Image.Resampling.NEAREST)
    alpha = o_resized.split()[3]
    red_sil = Image.new("RGBA", (o_size, o_size), (255, 51, 68, 255))
    red_sil.putalpha(alpha)

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for blur_r, opacity in ((max(2, o_size * 0.45), 180), (max(1, o_size * 0.18), 220)):
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        layer.paste(red_sil, (o_x, o_y), red_sil)
        layer = layer.filter(ImageFilter.GaussianBlur(radius=max(1, blur_r / 2)))
        a = layer.split()[3].point(lambda p, op=opacity: int(p * op / 255))
        layer.putalpha(a)
        glow = Image.alpha_composite(glow, layer)

    canvas = Image.alpha_composite(canvas, glow)
    canvas.paste(o_resized, (o_x, o_y), o_resized)

    caret_x = int(round(L["o_x"] + L["o_size"] + L["o_gap"]))
    caret_y = int(round(L["o_y"] + L["o_size"] + L["below_gap"]))
    caret_w = max(1, int(round(L["caret_w"])))
    caret_h = max(2, int(round(L["caret_h"])))

    caret_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cd = ImageDraw.Draw(caret_layer)
    cd.rectangle(
        [caret_x, caret_y, caret_x + caret_w - 1, caret_y + caret_h - 1],
        fill=accent,
    )

    for blur_r, opacity in ((max(2, caret_h * 1.8), 160), (max(1, caret_h * 0.75), 200)):
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
