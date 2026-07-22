# Quy tắc biên tập

Áp dụng cho mọi lời thoại và chữ trên màn hình.

## Cấu trúc chuẩn

| Vai trò | Thời lượng | Nhiệm vụ |
|---|---|---|
| `hook` | 0 – 3.5s | Giữ người xem. Đúng 1 cảnh, luôn ở đầu. |
| `body` | 3 – 5s/cảnh | Một cảnh một ý. Không nhồi. |
| `proof` | 3 – 5s | Bằng chứng cụ thể: bảo hành, số khách, chất liệu, test thực tế. |
| `price` | 3 – 5s | Giá và ưu đãi. Đặt ở khoảng 60–70% thời lượng, không đặt đầu. |
| `cta` | 2 – 4s | Đúng 1 cảnh, luôn ở cuối. |

Tổng: 15–60 giây. Ngọt nhất là 22–35 giây.

## Hook — 3 giây quyết định tất cả

Được:
- Câu gây khó chịu: "Ốp lưng 200K của bạn đang làm xước máy."
- Phản trực giác: "Miếng dán cường lực càng dày càng dễ vỡ."
- Cụ thể tới mức tò mò: "Cái ốp này rơi 47 lần vẫn chưa nứt."
- Câu hỏi nhắm đúng người: "Ai xài MacBook mà chưa từng lo xước mặt lưng?"

Cấm tuyệt đối:
- "Chào các bạn", "Xin chào", "Hôm nay mình sẽ..."
- "Bạn có biết rằng..."
- Đọc tên sản phẩm ra làm câu đầu tiên
- Bất kỳ câu nào phải xem hết mới hiểu tại sao đáng xem

## Viết lời

- **8–16 từ mỗi cảnh.** Dài hơn là đọc không kịp, phụ đề tràn khung.
- Câu ngắn. Nói như người thật nói chuyện, không như đọc quảng cáo.
- Chủ ngữ là người xem, không phải shop. "Bạn khỏi lo xước máy" > "Chúng tôi cung cấp giải pháp bảo vệ".
- Một cảnh một ý. Có chữ "và" nối hai ý là tách thành hai cảnh.
- Số cụ thể thắng tính từ. "Rơi 2 mét không sao" > "chống sốc cực tốt".

Không dùng: cực kỳ, siêu phẩm, đỉnh cao, không thể bỏ qua, must-have, xịn xò, must have, chất lượng tuyệt vời.

## Giá — chỗ dễ gây sự cố nhất

**Sản phẩm có `price_is_from: true` bắt buộc kèm "chỉ từ" hoặc "từ".**

Đúng: "Chỉ từ 590K" — Sai: "Chỉ 590K", "Giá 590K"

Lý do: Woo trả giá của biến thể rẻ nhất. Nói "590K" trong khi mẫu người ta muốn giá 1.290K là quảng cáo sai giá. Validator chặn cứng chỗ này.

Quy tắc khác:
- Giá trong lời thoại phải **khớp chính xác** với `products[].price_vnd`. Không làm tròn cho đẹp.
- Nói %giảm thì phải đúng `discount_pct`. Không "lên tới 50%" nếu cao nhất là 34%.
- Không bịa deadline. Không viết "chỉ hôm nay" trừ khi có chương trình thật.
- Không so sánh giá với đối thủ có tên.

## CTA

Mẫu dùng được:
- "Lucas.vn — chính hãng, bảo hành đầy đủ."
- "Link ở phần mô tả nha."
- "Ghé lucas.vn xem thêm màu."

Không: "Nhanh tay kẻo hết", "Số lượng có hạn", "Inbox ngay" (trừ khi thật sự chỉ bán qua inbox).

## Khác biệt giữa các format

- `hook` — cắt nhanh 195 BPM, năng lượng cao, 20–30s. Dùng cho sản phẩm giảm giá.
- `premium` — nhịp chậm, ít cảnh hơn, cảnh dài 5–6s. Dùng cho PITAKA, SATECHI, hàng cao cấp.
- `unbox` — cận cảnh sản phẩm, ít chữ, để hình nói. 25–40s.
- `podcast` — trích đoạn Chuyện Nhà Apple, giọng dẫn tự nhiên, không bán hàng trực tiếp.
- `threads` — nhiều sản phẩm, mỗi sản phẩm 1 cảnh, tiết tấu đều.

## Sự thật không được sai

Chỉ nói những gì có trong dữ liệu sản phẩm hoặc mô tả chính hãng. Không suy diễn thông số. Không có dữ liệu thì bỏ ý đó, đừng đoán.
