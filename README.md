# lucas-daily-reel

Mỗi ngày dựng một reel 1080×1920 từ dữ liệu sản phẩm lucas.vn, render bằng
[HyperFrames](https://github.com/heygen-com/hyperframes) (HTML → MP4), rồi đăng lên fanpage.

## Chạy thử tại máy

```bash
npm install
node lib/fetch-product.mjs 57586 build   # kéo từ Store API (public, không cần key)
node lib/build.mjs build                 # chọn template + ghép biến
npm run preview                          # xem trực tiếp trên browser
npm run render                           # xuất renders/reel.mp4
```

## Hai template

| | Khi nào dùng | Thời lượng |
|---|---|---|
| `templates/hook.html` | Giá < `premiumThreshold` | 8s |
| `templates/premium.html` | Giá ≥ `premiumThreshold` | 9s |

Thứ tự ưu tiên khi chọn: `template` trong `queue.json` → tag `reel-premium` / `reel-hook`
trên WooCommerce → ngưỡng giá trong `config.json` (mặc định 1.500.000₫).

## Hàng đợi

`queue.json` chứa danh sách sản phẩm. Workflow lấy phần tử đầu, quay xong đẩy xuống cuối
rồi commit lại. Sửa file này trên GitHub từ điện thoại là đổi được lịch.

Mỗi entry có thể kèm `copy` để đè nội dung chữ. Không có thì rơi về mặc định.

## Trước khi đăng thật

1. Điền `pageId` trong `config.json` (hoặc đặt secret `FB_PAGE_ID`).
2. Tạo Page Access Token với quyền `pages_manage_posts`, `pages_read_engagement`,
   `pages_show_list`. Đặt vào **Settings → Secrets → Actions → `FB_PAGE_TOKEN`**.
   Token không bao giờ nằm trong repo.
3. Workflow mặc định `DRY_RUN=true`: render xong upload artifact cho bạn tải về xem,
   không đăng gì. Chạy êm vài ngày rồi mới đặt repo variable `DRY_RUN=false`.

## Nhạc nền

Thả file vào `assets/bgm.mp4` là xong — `build.mjs` tự chèn thẻ `<audio>` vào composition.
Không có file thì render câm, không lỗi.

HyperFrames xử lý audio trong composition, không cần ffmpeg mux riêng.
Lệnh `npx hyperframes beats assets/bgm.mp4` dò nhịp nếu bạn muốn cắt cảnh theo beat.

**Cảnh báo bản quyền.** Reel đăng qua Graph API không dùng được trình chọn nhạc bản quyền
của Facebook — nhạc phải nằm sẵn trong MP4, và sẽ đi qua hệ thống nhận diện bản quyền.
Dùng Meta Sound Collection, YouTube Audio Library hoặc Pixabay. Tránh track NC nếu bán hàng.

## Giới hạn Reels

Hơn 3 giây, dưới 60 giây, MP4, 9:16, tối thiểu 1080p. Cả hai template (8s và 9s) đều hợp lệ.
Vùng 346px dưới đáy bị Facebook đắp caption và nút chia sẻ lên — template đã chừa sẵn.

## Font

`assets/fonts/` chứa Inter subset latin + latin-ext + vietnamese, nhúng thẳng vào repo.
Không gọi Google Fonts lúc render, nên không mất dấu tiếng Việt và không phụ thuộc mạng.
Ký tự ₫ (U+20AB) nằm trong subset vietnamese.

## Ảnh sản phẩm

Lấy `images[0].src` từ Store API (bản gốc 900×900), **không** lấy field `thumbnail`
(300×300, kéo lên khung 1080 sẽ vỡ).

Ảnh gốc nền trắng, không có kênh alpha. Template `hook` đặt ảnh trong một ô trắng bo góc
trên nền tối; template `premium` đặt ảnh vào giữa vũng sáng trắng nên mép tan vào nền.
Không cần tách nền.
