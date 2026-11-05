# Hàng đợi video sản phẩm web

Workflow `.github/workflows/drip-web.yml` chạy lúc 18:15 VN mỗi ngày, mỗi lần đăng 1 video lên fanpage.

Mỗi video là một thư mục `NN-<id sản phẩm>-<tên ngắn>/`, gồm:

- `final.mp4`: video đã được Admin xem và đồng ý.
- `caption.txt`: nội dung bài đăng.
- `comment.txt`: bình luận đầu tiên, chứa link đặt hàng.
- `post_after.txt` (không bắt buộc): mốc giờ sớm nhất được đăng, ví dụ `2026-11-06T18:00:00+07:00`.

Thứ tự đăng theo tên thư mục (`01-…`, `02-…`). Đăng xong, workflow tạo file `.posted` rồi commit. Muốn hoãn một video thì sửa `post_after.txt`. Muốn bỏ thì xóa thư mục trước giờ đăng.

Chạy tay (Actions → "Drip post web product reels" → Run workflow) mặc định `dry_run=true`: chỉ in caption, không đăng.
