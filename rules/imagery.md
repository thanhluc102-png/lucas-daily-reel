# Quy tắc ảnh minh hoạ AI

## Ranh giới cứng: không bao giờ vẽ sản phẩm bằng AI

Lucas bán hàng chính hãng. Ảnh AI **không được** dùng để mô tả món hàng đang bán —
không vẽ chiếc balo, không vẽ cái ốp, không vẽ củ sạc, kể cả khi nhìn "giống lắm rồi".

Lý do không phải thẩm mỹ mà là pháp lý và niềm tin:

- AI vẽ sai chi tiết mà mắt thường không bắt được: số ngăn, kiểu khoá, vị trí logo, số cổng.
  Khách nhận hàng thấy khác ảnh là hàng bị trả, và họ có lý.
- Quảng cáo hình ảnh không đúng sản phẩm thật là quảng cáo sai sự thật.
- Logo thương hiệu (Tomtoc, PITAKA, Anker...) do AI vẽ ra gần như luôn méo.
  Đó là nhãn hiệu của người khác, không phải thứ được phép chế lại.

**Ảnh sản phẩm luôn là `product_image`, lấy từ WooCommerce.** Không có ngoại lệ.

## Vậy dùng ảnh AI vào việc gì

Ba chỗ, đều là chỗ không có sản phẩm trong khung:

**1. Cảnh ẩn dụ cho hook.** Hook thường nói về một nỗi lo, chưa nói về sản phẩm.
   Ví dụ: mặt bàn cà phê ướt nước mưa, ba lô vải cũ sờn quai, màn hình laptop xước.

**2. Nền và không khí.** Bàn làm việc, quán cà phê Sài Gòn buổi sáng, đường phố lúc mưa,
   sảnh văn phòng. Dùng làm lớp nền phía sau chữ, hoặc chuyển cảnh.

**3. Hình khối trừu tượng.** Sóng ánh sáng, gradient navy-gold, hạt bụi bay.
   Dùng cho cảnh `price` và `cta` để tách khỏi phần kể chuyện.

## Cách viết prompt

Công thức: **chủ thể + bối cảnh + ánh sáng + góc máy + chất phim + điều cấm**

Mẫu dùng được:

```
a worn canvas backpack strap, close-up, resting on a wooden desk,
soft window light from the left, shallow depth of field, 35mm film grain,
muted navy and warm tones, no text, no logos, no brand marks, no people's faces
```

```
morning coffee shop table in Saigon, rain on the window behind,
overhead angle, natural diffused light, cinematic color grade,
deep navy shadows with warm gold highlights, no text, no logos
```

Bắt buộc có trong mọi prompt:

- `no text, no logos, no brand marks` — AI hay tự chế chữ nhìn như logo nhái
- `no readable faces` nếu có người trong khung — tránh chuyện chân dung
- tông màu neo về navy `#0B1B2E` / gold `#C9A227` để khớp bộ nhận diện

Không dùng trong prompt:

- Tên thương hiệu thật (Apple, MacBook, Tomtoc, PITAKA...)
- "in the style of [tên nghệ sĩ đang sống]"
- Mô tả kiểu ảnh chụp sản phẩm thương mại — dễ ra thứ trông như sản phẩm giả

## Giữ đồng nhất giữa các cảnh

Video 6 cảnh mà mỗi cảnh một phong cách ảnh thì rối. Cách giữ nhất quán:

- Dùng **cùng một câu tả ánh sáng và chất phim** cho mọi ảnh AI trong một video.
  Chỉ đổi phần chủ thể.
- Tỉ lệ 9:16 ngay từ lúc sinh, đừng sinh vuông rồi crop — crop hay mất chủ thể.
- Không trộn ảnh AI kiểu tả thực với ảnh AI kiểu minh hoạ phẳng trong cùng một video.

## Cần kiểm trước khi dùng

1. Trong khung có món hàng đang bán không → có thì bỏ, thay bằng `product_image`
2. Có chữ hoặc thứ trông như logo không → có thì sinh lại
3. Có bàn tay nào thừa ngón không → AI vẫn hay sai chỗ này
4. Đặt cạnh cảnh trước có lệch tông không
