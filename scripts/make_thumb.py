#!/usr/bin/env python3
"""
scripts/make_thumb.py
======================
Tạo thumbnail SEO 1200x630 branded cao cấp cho Lucas.vn (Ultra Crisp 2x Supersampled):
- Layout đảo ngược: Khung Card Sản Phẩm nằm BÊN TRÁI, Cột Chữ/CTA nằm BÊN PHẢI (Phân biệt với bài sản phẩm thường).
- Tương phản chữ hoàn hảo: Badge Kicker nền trắng viền xanh với chữ Xanh Đậm sắc nét.
- Hỗ trợ ghép 1, 2 hoặc 3 sản phẩm nổi bật (Multi-product Collage).
"""

import os
import sys
import io
import urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SCALE = 2
W, H = 1200 * SCALE, 630 * SCALE

NAVY        = (10, 15, 30)       # Nền tối góc trên-trái
EMERALD_BG  = (9, 68, 50)        # Nền xanh mượt góc dưới-phải
GREEN       = (16, 185, 129)     # #10b981
DARK_GREEN  = (9, 68, 50)        # Chữ xanh đậm cho badge
WHITE       = (255, 255, 255)

def _find_font(bold: bool, size: int):
    candidates = [
        # macOS
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        # Linux / Ubuntu Server
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf" if bold else "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

import urllib.parse

def _http_image(url: str):
    clean_url = urllib.parse.quote(url, safe=":/%?&=#")
    req = urllib.request.Request(clean_url, headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return Image.open(io.BytesIO(resp.read())).convert("RGBA")

def _load_image(src: str):
    if not src:
        return None
    try:
        if str(src).startswith("http"):
            return _http_image(src)
        return Image.open(src).convert("RGBA")
    except Exception as e:
        print(f"[!] Không tải được ảnh sản phẩm: {e}", file=sys.stderr)
        return None

def _rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=255)
    return m

def _gradient_bg(c1, c2):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    t = (xx / W) * 0.55 + (yy / H) * 0.45
    t = (t - t.min()) / (t.max() - t.min())
    arr = np.zeros((H, W, 3), dtype=np.float32)
    for i in range(3):
        arr[..., i] = c1[i] * (1 - t) + c2[i] * t
    return Image.fromarray(arr.astype(np.uint8), "RGB").convert("RGBA")

def _radial_glow(cx, cy, radius, color, max_alpha):
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    a = np.clip(1 - d / radius, 0, 1) ** 2.2
    arr = np.zeros((H, W, 4), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = color
    arr[..., 3] = (a * max_alpha).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")

def _wrap(draw, text, font, max_w):
    """Phân bổ dòng chữ CÂN ĐỐI (Balanced Line Wrap):
    Đảm bảo các dòng chữ có chiều rộng tương đương nhau, không bị mồ côi 1-2 từ ở dòng cuối
    và giữ nguyên các từ ghép tiếng Việt (như 'Ô Tô')."""
    words = text.split()
    if not words:
        return []

    # 1. Nếu vừa 1 dòng
    if draw.textlength(text, font=font) <= max_w:
        return [text]

    # 2. Thử chia 2 dòng cân đối nhất
    best_split_2 = None
    best_diff_2 = float('inf')

    for i in range(1, len(words)):
        # Không ngắt giữa chữ 'Ô' và 'Tô'
        if i > 0 and words[i-1].lower() == 'ô' and words[i].lower() == 'tô':
            continue

        l1 = " ".join(words[:i])
        l2 = " ".join(words[i:])
        w1 = draw.textlength(l1, font=font)
        w2 = draw.textlength(l2, font=font)
        if w1 <= max_w and w2 <= max_w:
            diff = abs(w1 - w2)
            if diff < best_diff_2:
                best_diff_2 = diff
                best_split_2 = [l1, l2]

    if best_split_2:
        return best_split_2

    # 3. Thử chia 3 dòng cân đối nhất
    best_split_3 = None
    best_diff_3 = float('inf')

    for i in range(1, len(words) - 1):
        for j in range(i + 1, len(words)):
            if (i > 0 and words[i-1].lower() == 'ô' and words[i].lower() == 'tô') or \
               (j > 0 and words[j-1].lower() == 'ô' and words[j].lower() == 'tô'):
                continue

            l1 = " ".join(words[:i])
            l2 = " ".join(words[i:j])
            l3 = " ".join(words[j:])
            w1 = draw.textlength(l1, font=font)
            w2 = draw.textlength(l2, font=font)
            w3 = draw.textlength(l3, font=font)
            if w1 <= max_w and w2 <= max_w and w3 <= max_w:
                diff = max(w1, w2, w3) - min(w1, w2, w3)
                if diff < best_diff_3:
                    best_diff_3 = diff
                    best_split_3 = [l1, l2, l3]

    if best_split_3:
        return best_split_3

    # Fallback greedy wrap
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

def create_seo_thumbnail(image_srcs: str, title: str, output_path: str, kicker="PHỤ KIỆN LUCAS.VN"):
    raw_urls = [u.strip() for u in image_srcs.split(',') if u.strip()][:3]
    prods = []
    for u in raw_urls:
        img_obj = _load_image(u)
        if img_obj is not None:
            prods.append(img_obj)

    if not prods:
        print("[!] Không tải được ảnh sản phẩm nào.", file=sys.stderr)
        sys.exit(1)

    # Nền gradient + halo glow 2x
    img = _gradient_bg(NAVY, EMERALD_BG)

    # ĐẢO VỊ TRÍ: CARD SẢN PHẨM NẰM BÊN TRÁI @2x (45px margin)
    card_w, card_h = 520 * SCALE, 520 * SCALE
    card_x = 45 * SCALE
    card_y = (H - card_h) // 2

    # Halo sáng quanh card bên trái
    glow = _radial_glow(card_x + card_w / 2, card_y + card_h / 2, 420 * SCALE, GREEN, 150)
    img.alpha_composite(glow)
    img.alpha_composite(_radial_glow(W - (150 * SCALE), 120 * SCALE, 400 * SCALE, GREEN, 35))

    # Shadow mềm cho card
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        [card_x + 8, card_y + 28, card_x + card_w + 8, card_y + card_h + 28],
        radius=80, fill=(0, 0, 0, 120))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(40)))

    # Card trắng bo góc 80px @2x
    card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    card.paste(Image.new("RGBA", (card_w, card_h), WHITE + (255,)), (0, 0),
               _rounded_mask((card_w, card_h), 80))
    img.alpha_composite(card, (card_x, card_y))

    # BỐ TRÍ SẢN PHẨM TRONG KHUNG CARD BÊN TRÁI
    if len(prods) == 1:
        inner = 70
        box_w, box_h = card_w - inner * 2, card_h - inner * 2
        p = prods[0].copy()
        p.thumbnail((box_w, box_h), Image.LANCZOS)
        px = card_x + (card_w - p.width) // 2
        py = card_y + (card_h - p.height) // 2
        img.alpha_composite(p, (px, py))
    elif len(prods) == 2:
        half_w = 420
        box_h = card_h - 200
        
        p1 = prods[0].copy()
        p1.thumbnail((half_w, box_h), Image.LANCZOS)
        px1 = card_x + 80 + (half_w - p1.width) // 2
        py1 = card_y + (card_h - p1.height) // 2
        img.alpha_composite(p1, (px1, py1))

        p2 = prods[1].copy()
        p2.thumbnail((half_w, box_h), Image.LANCZOS)
        px2 = card_x + card_w - 80 - half_w + (half_w - p2.width) // 2
        py2 = card_y + (card_h - p2.height) // 2
        img.alpha_composite(p2, (px2, py2))
    else:
        top_w, top_h = 460, 440
        bot_w, bot_h = 400, 400

        # SP1 (Top Center)
        p1 = prods[0].copy()
        p1.thumbnail((top_w, top_h), Image.LANCZOS)
        px1 = card_x + (card_w - p1.width) // 2
        py1 = card_y + 100 + (top_h - p1.height) // 2
        img.alpha_composite(p1, (px1, py1))

        # SP2 (Bottom Left)
        p2 = prods[1].copy()
        p2.thumbnail((bot_w, bot_h), Image.LANCZOS)
        px2 = card_x + 80 + (bot_w - p2.width) // 2
        py2 = card_y + 540 + (bot_h - p2.height) // 2
        img.alpha_composite(p2, (px2, py2))

        # SP3 (Bottom Right)
        p3 = prods[2].copy()
        p3.thumbnail((bot_w, bot_h), Image.LANCZOS)
        px3 = card_x + card_w - 80 - bot_w + (bot_w - p3.width) // 2
        py3 = card_y + 540 + (bot_h - p3.height) // 2
        img.alpha_composite(p3, (px3, py3))

    # Badge "HOT 2026" / "TOP SẢN PHẨM"
    draw = ImageDraw.Draw(img)
    tag_font = _find_font(True, 44)
    tag_txt = "TOP SẢN PHẨM" if len(prods) > 1 else "HOT 2026"
    tw = draw.textlength(tag_txt, font=tag_font)
    tag_w, tag_h = int(tw) + 72, 88
    tag_x, tag_y = card_x + 40, card_y + 40
    draw.rounded_rectangle([tag_x, tag_y, tag_x + tag_w, tag_y + tag_h], radius=28, fill=(239, 68, 68))
    draw.text((tag_x + 36, tag_y + tag_h / 2), tag_txt, font=tag_font, fill=WHITE, anchor="lm")

    # -------------------------------------------------------------
    # CỘT CHỮ VÀ CTA NẰM BÊN PHẢI @2x
    # -------------------------------------------------------------
    text_x = card_x + card_w + 100
    cursor_y = 96
    text_max_w = W - text_x - 80

    # Kicker Pill Label (Nền trắng viền nổi với CHỮ XANH ĐẬM TƯƠNG PHẢN CAO 100%)
    kf = _find_font(True, 42)
    kick = kicker.upper()
    kw = draw.textlength(kick, font=kf)
    pill_bw = int(kw) + 76
    pill_bh = 84
    draw.rounded_rectangle([text_x, cursor_y, text_x + pill_bw, cursor_y + pill_bh],
                           radius=42, fill=WHITE)
    draw.text((text_x + 38, cursor_y + pill_bh / 2), kick, font=kf, fill=DARK_GREEN, anchor="lm")
    cursor_y += pill_bh + 40

    # Tiêu đề bài viết @2x (Bắt đầu từ size 144 down đến 64 để lấp đầy 100% cột phải)
    clean_title = (title or "").replace(" | Lucas Combo", "").strip()
    cta_h = 120
    bottom_limit = H - 96 - cta_h - 40
    avail_h = bottom_limit - cursor_y
    chosen, lines = None, None
    for size in (144, 134, 124, 114, 104, 94, 84, 74, 64, 56, 48, 42):
        f = _find_font(True, size)
        ls = _wrap(draw, clean_title, f, text_max_w)
        line_h = int(size * 1.35)
        if len(ls) * line_h <= avail_h:
            chosen, lines = f, ls
            break
    if chosen is None:
        chosen = _find_font(True, 42)
        lines = _wrap(draw, clean_title, chosen, text_max_w)

    size = chosen.size
    line_h = int(size * 1.35)
    block_h = len(lines) * line_h
    ty = cursor_y + max(0, (avail_h - block_h) // 2)
    for ln in lines:
        draw.text((text_x, ty), ln, font=chosen, fill=WHITE)
        ty += line_h

    # Nút CTA "Đặt hàng tại lucas.vn  ›" @2x
    cta = "Đặt hàng tại lucas.vn  ›"
    cf = _find_font(True, 50)
    cw = draw.textlength(cta, font=cf)
    pill_w = int(cw) + 112
    pill_y = H - 96 - cta_h
    draw.rounded_rectangle([text_x, pill_y, text_x + pill_w, pill_y + cta_h], radius=60, fill=GREEN)
    draw.text((text_x + 56, pill_y + cta_h / 2), cta, font=cf, fill=WHITE, anchor="lm")

    # Downsample về 1200x630 bằng Lanczos filter
    final_img = img.resize((1200, 630), Image.LANCZOS)
    
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    final_img.convert("RGB").save(output_path, "JPEG", quality=96)
    print(f"✅ Đã thiết kế Ultra Crisp Thumbnail (Card Bên Trái, Chữ Nét Bên Phải) thành công: {output_path}")

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Sử dụng: python3 make_thumb.py <image_urls_comma_separated> <title> <output_path> [kicker]")
        sys.exit(1)

    img_urls = sys.argv[1]
    title = sys.argv[2]
    out_path = sys.argv[3]
    kicker = sys.argv[4] if len(sys.argv) > 4 else "PHỤ KIỆN LUCAS.VN"

    create_seo_thumbnail(img_urls, title, out_path, kicker)
