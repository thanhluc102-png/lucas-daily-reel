#!/usr/bin/env python3
"""
SMART CUTOUT — Tự động phân loại và tách nền thông minh cho ảnh sản phẩm Lucas.

Cách dùng:
  python3 scripts/smart_cutout.py <input.png> <output_cutout.png>

Trả về JSON trên stdout:
  {"mode": "cutout", "fg_pct": 40.9}  -> Ảnh chụp sản phẩm phông trắng sạch, đã xuất file PNG tách nền + khử răng cưa.
  {"mode": "card",   "reason": "..."} -> Ảnh chụp thực tế (lifestyle) hoặc ảnh infographic có chữ, giữ nguyên khung Card.
"""
import json
import sys
import numpy as np
from PIL import Image, ImageFilter


def process(in_path, out_path):
    im = Image.open(in_path).convert("RGBA")
    a = np.array(im, dtype=np.int16)
    h, w, _ = a.shape

    # 1. Kiểm tra 4 cạnh viền: ảnh studio phông trắng phải có >= 94% điểm ảnh viền màu trắng sáng
    border = np.concatenate([
        a[:10, :, :3].reshape(-1, 3),
        a[-10:, :, :3].reshape(-1, 3),
        a[:, :10, :3].reshape(-1, 3),
        a[:, -10:, :3].reshape(-1, 3),
    ])
    white_pct = float(np.mean(np.all(border > 238, axis=1)) * 100.0)

    # 2. Kiểm tra dải chữ infographic ở đầu/cuối ảnh (nếu có chữ đen trên nền trắng thì giữ nguyên Card để đọc được chữ)
    top_band = a[int(h * 0.03):int(h * 0.16), int(w * 0.08):int(w * 0.92), :3]
    bot_band = a[int(h * 0.84):int(h * 0.97), int(w * 0.08):int(w * 0.92), :3]
    dark_top = float(np.mean(np.all(top_band < 120, axis=2)) * 100.0)
    dark_bot = float(np.mean(np.all(bot_band < 120, axis=2)) * 100.0)

    if white_pct < 94.0 or dark_top > 2.5 or dark_bot > 2.5:
        return {
            "mode": "card",
            "reason": f"white={white_pct:.1f}%, top={dark_top:.1f}%, bot={dark_bot:.1f}%",
        }

    # 3. Floodfill bảo toàn vật thể trắng: chỉ loang vùng trắng tinh (>= 246) từ 4 cạnh vào
    is_bg = (a[:, :, 0] >= 246) & (a[:, :, 1] >= 246) & (a[:, :, 2] >= 246)
    visited = np.zeros((h, w), dtype=bool)
    q = []

    for x in range(w):
        if is_bg[0, x]:
            visited[0, x] = True
            q.append((0, x))
        if is_bg[h - 1, x]:
            visited[h - 1, x] = True
            q.append((h - 1, x))
    for y in range(h):
        if is_bg[y, 0]:
            visited[y, 0] = True
            q.append((y, 0))
        if is_bg[y, w - 1]:
            visited[y, w - 1] = True
            q.append((y, w - 1))

    head = 0
    while head < len(q):
        cy, cx = q[head]
        head += 1
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and is_bg[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))

    fg_pct = float((1.0 - np.mean(visited)) * 100.0)
    if fg_pct < 12.0 or fg_pct > 85.0:
        return {"mode": "card", "reason": f"fg_pct={fg_pct:.1f}%"}

    # 4. Làm mượt biên alpha (co 1px khử viền trắng + blur nhẹ 1.2px chống răng cưa)
    alpha = (~visited).astype(np.uint8) * 255
    alpha_img = (
        Image.fromarray(alpha, mode="L")
        .filter(ImageFilter.MinFilter(3))
        .filter(ImageFilter.GaussianBlur(1.2))
    )
    out = np.array(im)
    out[:, :, 3] = np.array(alpha_img)
    Image.fromarray(out, "RGBA").save(out_path, "PNG")
    return {"mode": "cutout", "fg_pct": round(fg_pct, 1)}


if __name__ == "__main__":
    try:
        res = process(sys.argv[1], sys.argv[2])
        print(json.dumps(res))
    except Exception as exc:
        print(json.dumps({"mode": "card", "reason": str(exc)}))

