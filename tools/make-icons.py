"""
アイコンを作るスクリプト(手元で 1 回動かして icons/ に書き出す。アプリの動作には使わない)

図柄:青い角丸の四角に、右上がりの白い 3 本の棒と下線(このアプリ独自の、ごく単純な形)。
  icons/icon.svg              ブラウザのタブ用(角丸)
  icons/icon-32.png           ブラウザのタブ用(PNG)
  icons/icon-192.png          ホーム画面用(角丸)
  icons/icon-512.png          ホーム画面用(角丸)
  icons/icon-maskable-512.png Android などで丸や角丸に切り抜かれる用(全面の背景、図柄は中央 60% に)
  icons/apple-touch-icon.png  iPhone のホーム画面用(180×180。角は iPhone が丸めるので四角のまま)

使い方(リポジトリのいちばん上で):python3 tools/make-icons.py   (Pillow が必要)
"""
from pathlib import Path

from PIL import Image, ImageDraw

BLUE = (37, 106, 191, 255)  # --accent と同じ
WHITE = (255, 255, 255, 255)
LINE = (255, 255, 255, 140)
ROOT = Path(__file__).resolve().parent.parent / "icons"

# 512 × 512 の座標での図柄(棒 3 本と下線)
BARS = [(116, 276, 192, 400), (218, 206, 294, 400), (320, 128, 396, 400)]
BASE = (100, 414, 412, 428)


def draw(size, rounded=True, scale=1.0):
    """size × size の画像。scale は図柄の大きさ(maskable では小さくして中央に)"""
    big = size * 4  # 4 倍で描いて縮める(輪郭をなめらかに)
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = big / 512
    if rounded:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=112 * k, fill=BLUE)
    else:
        d.rectangle((0, 0, big, big), fill=BLUE)

    def tx(x, y):
        # 中心(256, 256)から scale 倍にしてから、画像の大きさへ
        return ((256 + (x - 256) * scale) * k, (256 + (y - 256) * scale) * k)

    for x0, y0, x1, y1 in BARS:
        d.rounded_rectangle((*tx(x0, y0), *tx(x1, y1)), radius=16 * k * scale, fill=WHITE)
    d.rounded_rectangle((*tx(BASE[0], BASE[1]), *tx(BASE[2], BASE[3])), radius=7 * k * scale, fill=LINE)
    return img.resize((size, size), Image.LANCZOS)


def main():
    ROOT.mkdir(exist_ok=True)
    draw(32).save(ROOT / "icon-32.png")
    draw(192).save(ROOT / "icon-192.png")
    draw(512).save(ROOT / "icon-512.png")
    draw(512, rounded=False, scale=0.72).save(ROOT / "icon-maskable-512.png")
    draw(180, rounded=False).convert("RGB").save(ROOT / "apple-touch-icon.png")
    svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#256abf"/>
  <g fill="#ffffff">
    <rect x="116" y="276" width="76" height="124" rx="16"/>
    <rect x="218" y="206" width="76" height="194" rx="16"/>
    <rect x="320" y="128" width="76" height="272" rx="16"/>
  </g>
  <rect x="100" y="414" width="312" height="14" rx="7" fill="#ffffff" fill-opacity="0.55"/>
</svg>
"""
    (ROOT / "icon.svg").write_text(svg, encoding="utf-8")
    print("icons:", ", ".join(sorted(p.name for p in ROOT.iterdir())))


if __name__ == "__main__":
    main()
