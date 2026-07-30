# CLAUDE.md

Repo sản xuất video ngắn cho **Lucas Combo** (lucas.vn) — shop phụ kiện Apple, TP.HCM.

Đọc file này trước khi làm bất cứ việc gì trong repo.

## Việc của bạn ở đây

Nhận yêu cầu tiếng Việt → tạo `scenes.json` hợp lệ → render → giao file mp4 cho người dùng duyệt.

## Quy trình bắt buộc

1. Đọc `rules/editorial.md` và `rules/visual.md`. Luôn đọc, kể cả khi thấy quen.
2. Lấy dữ liệu sản phẩm **thật** qua `adapters.mjs` → `getProducts()`. Không bịa tên, giá, %giảm.
3. Viết `scenes.json` theo `schema/scenes.schema.json`. Xem mẫu ở `schema/example.scenes.json`.
4. **Chạy `node scripts/validate.mjs <file>` trước khi render.** Còn ERROR thì sửa, không render.
5. Render.
6. Chạy `qcVideo`. FAIL thì sửa, render lại, tối đa 2 lần.
7. Báo đường dẫn file. **Dừng ở đây.**

## Ranh giới cứng

- **Không tự đăng bài.** Chỉ đăng khi người dùng đã xem video và nói rõ đồng ý. Không suy diễn từ câu "ok" chung chung.
- **Không sửa file trong `rules/`** trừ khi người dùng yêu cầu thẳng. Đó là trí nhớ của repo, không phải nháp.
- **Không hạ tiêu chuẩn validator** để cho qua. Validator báo lỗi nghĩa là nội dung sai, không phải validator sai.
- **Không bịa số liệu.** Không có dữ liệu thì nói không có.

## Bẫy đã từng gây sự cố

**Sản phẩm biến thể (variable) trả về giá THẤP NHẤT.** Woo REST trả `price` là giá của biến thể rẻ nhất. Nói "590K" cho một dòng sản phẩm có mẫu 1.290K là quảng cáo sai giá trên page có hơn 500.000 khách. Cờ `price_is_from: true` trong `scenes.json` bắt buộc kèm chữ "chỉ từ". Validator chặn việc này — đừng bypass.

## Cấu trúc

```
CLAUDE.md              file này
rules/editorial.md     quy tắc viết lời — hook, nhịp, giá, CTA
rules/visual.md        quy tắc hình ảnh — khung an toàn, crop, màu
schema/                schema + mẫu scenes.json
scripts/validate.mjs   validator, chạy trước mọi lần render
adapters.mjs           nối vào WooCommerce / TTS / renderer / Graph API
agent.mjs              vòng lặp agent chạy tự động (dùng cho cron)
jobs/                  mỗi video một thư mục
runs/                  log agent, để debug
```

## Thương hiệu

- Tên: Lucas Combo, gọi tắt "Lucas". Website lucas.vn.
- Màu: navy `#0B1B2E`, gold `#C9A227`.
- Từ 2017, hơn 500.000 khách, ~21 thương hiệu (Tomtoc, PITAKA, Anker, JCPAL, Innostyle, SATECHI, WiWU...).
- Giọng thương hiệu: thẳng, hiểu chuyện, không nổ. Không dùng "cực kỳ", "siêu phẩm", "đỉnh cao".
