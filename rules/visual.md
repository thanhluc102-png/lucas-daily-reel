# Quy tắc hình ảnh

## Khung

- Luôn 1080 × 1920 (9:16). Không xuất tỉ lệ khác.
- **Vùng an toàn:** chừa 220px trên và 320px dưới. UI của TikTok/Reels che chỗ đó.
- Chữ quan trọng và giá phải nằm trong dải giữa: y từ 400 đến 1500.
- Phụ đề đặt ở y ≈ 1250. Đừng để thấp hơn, nút của TikTok đè lên.

## Màu

| Dùng cho | Mã |
|---|---|
| Nền | `#0B1B2E` navy |
| Điểm nhấn, giá, CTA | `#C9A227` gold |
| Chữ thường | `#FFFFFF` |
| Chữ phụ | `#9FB0C4` |

Không thêm màu thứ tư. Muốn nhấn thì đổi độ đậm chữ hoặc kích thước, đừng đổi màu.

## Ảnh sản phẩm

- Lấy từ WooCommerce, dùng ảnh `src` gốc, không dùng thumbnail.
- Nền ảnh sản phẩm của Lucas thường trắng → đặt lên nền navy phải có bo góc 24px và đổ bóng, nếu không sẽ như dán vụng.
- Ảnh dưới 800px chiều rộng thì bỏ, đừng phóng to.
- Một cảnh một sản phẩm. Ghép nhiều sản phẩm vào một khung chỉ dùng cho format `threads`.

## Chuyển động

- Ảnh tĩnh phải có chuyển động nhẹ: zoom chậm 1.0 → 1.08 suốt thời lượng cảnh. Ảnh đứng yên trông như lỗi.
- Cắt cảnh khớp beat. 195 BPM ≈ 0.308s/beat; cảnh nên dài bội số của beat.
- Không dùng hiệu ứng chuyển cảnh loè loẹt. Cắt thẳng hoặc mờ 6 frame.

## Chữ

- Font: một font sans đậm cho tiêu đề, cùng font nhẹ hơn cho phụ đề. Không trộn hai font khác họ.
- Tiếng Việt có dấu — **kiểm tra font đủ glyph** trước khi render. Thiếu dấu là lỗi hay gặp nhất với font nước ngoài.
- Phụ đề tối đa 2 dòng, mỗi dòng tối đa 22 ký tự.
- Chữ trên ảnh sáng phải có nền mờ phía sau, không dựa vào viền chữ.

## Badge giá

- Đặt góc trên bên phải vùng an toàn.
- Có `price_is_from: true` thì badge phải in chữ "CHỈ TỪ" nhỏ phía trên con số. Không được bỏ.
- Giá gạch (giá gốc) in nhỏ hơn, màu `#9FB0C4`, gạch ngang.

## Cần kiểm trước khi giao

1. Xuất đúng 1080×1920 chưa
2. Chữ có bị vùng an toàn cắt không
3. Dấu tiếng Việt có hiện đủ không
4. Badge "CHỈ TỪ" có đúng với `price_is_from` không
5. Có audio track không, có bị vỡ tiếng không
