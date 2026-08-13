"""Rebuild brand-mark PNGs: transparent plate, tight crop, no black square."""
from __future__ import annotations

from collections import deque
from pathlib import Path

from PIL import Image

PUB = Path(__file__).resolve().parents[1] / "public"
SHOT = Path(
    r"C:\Users\Julia\.cursor\projects\c-Users-Julia-Projects-task-manager\assets"
    r"\c__Users_Julia_AppData_Roaming_Cursor_User_workspaceStorage_empty-window_images"
    r"_image-05bb5f72-1747-464d-bbf7-7f204ed08853.png"
)


def is_bg(r: int, g: int, b: int, a: int) -> bool:
    if a < 8:
        return True
    if max(r, g, b) <= 14 and abs(r - g) <= 3 and abs(g - b) <= 3:
        return True
    return False


def make_transparent(src: Image.Image) -> Image.Image:
    img = src.convert("RGBA")
    px = img.load()
    w, h = img.size
    vis = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    def enq(x: int, y: int) -> None:
        if x < 0 or y < 0 or x >= w or y >= h or vis[y][x]:
            return
        r, g, b, a = px[x, y]
        if not is_bg(r, g, b, a):
            return
        vis[y][x] = True
        q.append((x, y))

    for x in range(w):
        enq(x, 0)
        enq(x, h - 1)
    for y in range(h):
        enq(0, y)
        enq(w - 1, y)

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            enq(nx, ny)

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 0 and max(r, g, b) <= 8:
                px[x, y] = (0, 0, 0, 0)

    for y in range(1, h - 1):
        for x in range(1, w - 1):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if max(r, g, b) > 22:
                continue
            if abs(r - g) > 4 or abs(g - b) > 4:
                continue
            near_clear = any(
                px[x + dx, y + dy][3] == 0
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1))
            )
            if not near_clear:
                continue
            bright = max(r, g, b)
            if bright <= 12:
                px[x, y] = (r, g, b, 0)
            elif bright <= 18:
                px[x, y] = (r, g, b, int(a * 0.4))

    return img


def crop_square(img: Image.Image) -> Image.Image:
    px = img.load()
    w, h = img.size
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 12:
                minx = min(minx, x)
                miny = min(miny, y)
                maxx = max(maxx, x)
                maxy = max(maxy, y)
    pad = 8
    minx = max(0, minx - pad)
    miny = max(0, miny - pad)
    maxx = min(w - 1, maxx + pad)
    maxy = min(h - 1, maxy + pad)
    crop = img.crop((minx, miny, maxx + 1, maxy + 1))
    side = max(crop.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ox = (side - crop.size[0]) // 2
    oy = (side - crop.size[1]) // 2
    canvas.paste(crop, (ox, oy), crop)
    return canvas.resize((512, 512), Image.Resampling.LANCZOS)


def main() -> None:
    raw = Image.open(SHOT if SHOT.is_file() else PUB / "favicon.png")
    out = crop_square(make_transparent(raw))
    out.save(PUB / "brand-mark.png", optimize=True)
    out.save(PUB / "brand-mark-light.png", optimize=True)
    px = out.load()
    w, h = out.size
    trans = sum(1 for y in range(h) for x in range(w) if px[x, y][3] < 10)
    black = sum(
        1
        for y in range(h)
        for x in range(w)
        if px[x, y][3] > 200 and max(px[x, y][:3]) <= 8
    )
    print("wrote brand-mark.png / brand-mark-light.png")
    print("trans", trans, "black_op", black, "corner", px[0, 0])


if __name__ == "__main__":
    main()
