from PIL import Image, ImageDraw
from pathlib import Path


def draw_eye(size: int) -> Image.Image:
    s = size
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = max(2, int(s * 14 / 64))
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=(20, 18, 16, 255))

    def sc(x: float, y: float | None = None):
        if y is None:
            return x * s / 64
        return x * s / 64, y * s / 64

    cx, cy = sc(32, 32)
    rx, ry = sc(22), sc(11.5)
    d.ellipse(
        [cx - rx, cy - ry, cx + rx, cy + ry],
        fill=(244, 239, 232, 255),
        outline=(10, 9, 8, 255),
        width=max(1, s // 42),
    )

    ir = sc(9.2)
    d.ellipse([cx - ir, cy - ir, cx + ir, cy + ir], fill=(26, 16, 12, 255))

    orange = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    od = ImageDraw.Draw(orange)
    orr = sc(7.2)
    od.ellipse([cx - orr, cy - orr, cx + orr, cy + orr], fill=(255, 107, 53, 90))
    im = Image.alpha_composite(im, orange)
    d = ImageDraw.Draw(im)

    pr = sc(5.1)
    for i, col in enumerate(
        [
            (196, 58, 16, 255),
            (255, 107, 53, 255),
            (255, 154, 60, 255),
            (255, 224, 138, 255),
        ]
    ):
        rr = pr * (1 - i * 0.22)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=col)

    hr = sc(1.6)
    hy = cy - sc(0.8)
    d.ellipse([cx - hr, hy - hr, cx + hr, hy + hr], fill=(255, 246, 200, 230))
    return im


def main() -> None:
    pub = Path(r"C:\Users\Julia\Projects\task-manager\frontend\public")
    master = draw_eye(512)
    master.save(pub / "favicon.png", optimize=True)
    master.resize((180, 180), Image.Resampling.LANCZOS).save(
        pub / "apple-touch-icon.png", optimize=True
    )
    for n in (64, 48, 32, 16):
        master.resize((n, n), Image.Resampling.LANCZOS).save(
            pub / f"favicon-{n}.png", optimize=True
        )
    ico32 = master.resize((32, 32), Image.Resampling.LANCZOS)
    ico32.save(pub / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)])
    print("done")
    for p in sorted(pub.glob("favicon*")):
        print(p.name, p.stat().st_size)
    print("apple-touch-icon.png", (pub / "apple-touch-icon.png").stat().st_size)


if __name__ == "__main__":
    main()
