# Nhạc nền

Thả file nhạc vào ĐÂY (`assets/bgm/`). Mỗi video sẽ bốc một bài.

- Định dạng nhận: `.mp3` `.m4a` `.aac` `.wav` `.ogg` `.opus` `.flac` `.mp4`
- Bài nào cũng được tự chuẩn hoá về −17.5 LUFS rồi mới hạ xuống nền, nên
  không cần tự chỉnh to nhỏ trước. Bài dài hơn video sẽ bị cắt, ngắn hơn thì lặp.
- Bốc bài theo `job_id`: render lại cùng một job ra đúng bài cũ, 3 suất đăng
  trong ngày ra 3 bài khác nhau.
- Vào bài ở giây 15–20 chứ không phải giây 0, vì intro nhạc production thường
  loãng. Kèm fade-in 0.4s cho khỏi nổ đột ngột. Bài quá ngắn (không đủ chỗ cho
  điểm vào + độ dài video) thì tự lùi về giây 0 rồi lặp.
- Thư mục này trống thì quay về dùng `assets/bgm.mp4` như trước.

**Bản quyền:** page đăng Facebook/TikTok nên chỉ dùng nhạc được cấp phép thương
mại — TikTok Commercial Music Library, Facebook Sound Collection, YouTube Audio
Library. Nhạc có bản quyền sẽ bị tắt tiếng hoặc gỡ bài.
