# Zenlo – draws site/og.png, the picture shown when a link to the website is shared.
# Needs Pillow and the Windows fonts Segoe UI and Consolas. Run: python scripts/og-image.py site/og.png

from PIL import Image, ImageDraw, ImageFont
import sys

W, H = 1200, 630
S = 2  # draw at 2x, then downscale for smooth edges
BG = (14, 12, 20)
SURFACE = (26, 23, 36)
LINE = (43, 38, 56)
TEXT = (236, 233, 245)
MUTED = (167, 161, 188)
ACCENT = (167, 139, 250)
CHIP_BG = (40, 33, 64)

F = 'C:/Windows/Fonts/'
def font(name, size):
    return ImageFont.truetype(F + name, size * S)

img = Image.new('RGB', (W * S, H * S), BG)
d = ImageDraw.Draw(img)

def logo(x, y, size, width):
    k = size / 24
    box = [(x + 4 * k) * S, (y + 4 * k) * S, (x + 20 * k) * S, (y + 20 * k) * S]
    d.arc(box, start=0, end=335, fill=ACCENT, width=int(width * S))
    pts = [(9, 9), (15, 9), (9, 15), (15, 15)]
    d.line([((x + px * k) * S, (y + py * k) * S) for px, py in pts], fill=ACCENT, width=int(width * S), joint='curve')

# Brand
logo(72, 64, 52, 4.5)
d.text((136 * S, 70 * S), 'zenlo', font=font('segoeuib.ttf', 34), fill=TEXT)
d.text((240 * S, 86 * S), 'by stephit', font=font('consola.ttf', 18), fill=MUTED)

# Headline
title = font('segoeuib.ttf', 54)
d.text((72 * S, 178 * S), 'Ba trăm tin chưa đọc,', font=title, fill=TEXT)
d.text((72 * S, 254 * S), 'đọc trong mười giây.', font=title, fill=ACCENT)
d.text((72 * S, 352 * S), 'Zenlo tóm tắt hội thoại ngay', font=font('segoeui.ttf', 28), fill=MUTED)
d.text((72 * S, 392 * S), 'trong Zalo PC. Miễn phí.', font=font('segoeui.ttf', 28), fill=MUTED)

# Summary card
cx, cy, cw, ch = 700, 140, 430, 350
d.rounded_rectangle([cx * S, cy * S, (cx + cw) * S, (cy + ch) * S], radius=22 * S, fill=SURFACE, outline=LINE, width=2 * S)
mono = font('consola.ttf', 15)
d.text(((cx + 28) * S, (cy + 26) * S), 'Team Marketing · 35 tin', font=mono, fill=MUTED)
d.text(((cx + 28) * S, (cy + 64) * S), 'LIÊN QUAN TỚI BẠN', font=font('segoeuib.ttf', 15), fill=ACCENT)

body = font('segoeui.ttf', 21)
rows = [
    ('Gửi chị Hoa slide trước 9h mai.', '19/10 08:30'),
    ('Gửi Quang ảnh sản phẩm tối nay.', '19/10 17:45'),
    ('Nộp báo cáo trước 12h trưa mai.', '19/10 17:30'),
]
y = cy + 100
for text, cite in rows:
    d.ellipse([(cx + 30) * S, (y + 12) * S, (cx + 38) * S, (y + 20) * S], fill=ACCENT)
    d.text(((cx + 50) * S, y * S), text, font=body, fill=TEXT)
    tw = d.textlength(cite, font=mono) / S
    d.rounded_rectangle([(cx + 50) * S, (y + 36) * S, (cx + 50 + tw + 16) * S, (y + 62) * S], radius=6 * S, fill=CHIP_BG)
    d.text(((cx + 58) * S, (y + 40) * S), cite, font=mono, fill=ACCENT)
    y += 82

# Footer line
d.text((72 * S, 548 * S), 'Zalo PC · Windows 10/11', font=font('consola.ttf', 20), fill=MUTED)
d.text((690 * S, 548 * S), 'stephitnoob.github.io/zenlo', font=font('consola.ttf', 20), fill=MUTED)

img.resize((W, H), Image.LANCZOS).save(sys.argv[1], optimize=True)
