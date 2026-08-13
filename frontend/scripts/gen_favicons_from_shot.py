"""Regenerate TaskMaster favicons from the detailed eye screenshot."""
from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUB = ROOT / "public"
SRC = Path(
    r"C:\Users\Julia\.cursor\projects\c-Users-Julia-Projects-task-manager\assets"
    r"\c__Users_Julia_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images"
    r"_image-05bb5f72-1747-464d-bbf7-7f204ed08853.png"
)


def square_from_screenshot(src: Path) -> Image.Image:
    img = Image.open(src).convert("RGBA")
    px = img.load()
    w, h = img.size

    def is_bg(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        return a < 10 or (r + g + b) < 18

    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            if not is_bg(x, y):
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)

    crop = img.crop((minx, miny, maxx + 1, maxy + 1))
    side = max(crop.size)
    pad = int(side * 0.04)
    canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 255))
    ox = (canvas.size[0] - crop.size[0]) // 2
    oy = (canvas.size[1] - crop.size[1]) // 2
    canvas.paste(crop, (ox, oy), crop)
    return canvas.resize((512, 512), Image.Resampling.LANCZOS)


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Source screenshot not found: {SRC}")

    master = square_from_screenshot(SRC)
    master.save(PUB / "favicon.png", optimize=True)
    master.resize((180, 180), Image.Resampling.LANCZOS).convert("RGB").save(
        PUB / "apple-touch-icon.png", optimize=True
    )
    for n in (64, 48, 32, 16):
        master.resize((n, n), Image.Resampling.LANCZOS).save(
            PUB / f"favicon-{n}.png", optimize=True
        )

    sizes = [16, 32, 48, 64, 256]
    icons = [master.resize((s, s), Image.Resampling.LANCZOS) for s in sizes]
    icons[-1].save(
        PUB / "favicon.ico",
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=icons[:-1],
    )

    buf = io.BytesIO()
    master.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    (PUB / "favicon.svg").write_text(
        (
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" '
            'role="img" aria-label="TaskMaster">\n'
            f'  <image href="data:image/png;base64,{b64}" width="512" height="512"/>\n'
            "</svg>\n"
        ),
        encoding="utf-8",
    )

    for p in sorted(PUB.glob("favicon*")) + [PUB / "apple-touch-icon.png"]:
        print(p.name, p.stat().st_size)


if __name__ == "__main__":
    main()
