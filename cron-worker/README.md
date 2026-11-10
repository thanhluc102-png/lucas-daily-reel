# lucas-reel-cron

Worker Cloudflare canh giờ đăng bài cho repo này.

Lịch hẹn (cron) của GitHub ở repo này hay trễ 6–8 tiếng, có lượt còn bị bỏ. Lệnh "chạy ngay" (workflow_dispatch) thì GitHub chạy liền. Worker này đến đúng giờ thì gọi lệnh đó.

| Giờ VN | cron (UTC) | Workflow | Input |
|---|---|---|---|
| 08:30 | `30 1 * * *` | `daily-reel-v2.yml` | `dry_run=false`, `guard=true` |
| 18:15 | `15 11 * * *` | `drip-web.yml` | `dry_run=false` |

Worker không tự đăng gì. Khóa an toàn nằm trong chính các workflow:
- `daily-reel-v2.yml`: với `guard=true`, bài phải cách bài trước ít nhất 14 tiếng.
- `drip-web.yml`: chỉ đăng trong khung 17:45–21:30, tối đa 1 bài/ngày, đúng `post_after`.

Các mốc cron cũ của GitHub vẫn giữ làm dự phòng. Lượt nào chạy trùng thì tự bỏ qua.

## Mã GitHub

- Worker dùng secret `GITHUB_TOKEN`: fine-grained token của tài khoản `thanhluc102-png`, chỉ cho repo `lucas-daily-reel`, quyền **Actions: Read and write**.
- Mã đặt trong Cloudflare: Workers & Pages → `lucas-reel-cron` → Settings → Variables and Secrets. Không bao giờ lưu mã trong repo.
- Mã hết hạn thì tạo mã mới với đúng quyền trên, rồi thay giá trị secret.

## Sửa và đưa lên

- Đổi giờ: sửa `triggers.scheduled(...)` trong `cloudflare.config.ts`, và việc tương ứng trong `JOBS` ở `src/index.ts`. Hai chỗ phải khớp nhau, giờ tính theo UTC (VN = UTC + 7).
- Đưa lên: `npm install`, rồi `npx cf deploy`. Dùng CLI `cf`, tài khoản Cloudflare `thanhluc102@gmail.com`.
- Xem lượt chạy:
  - Cloudflare: `lucas-reel-cron` → Observability → Logs.
  - GitHub Actions: các lượt có event `workflow_dispatch`.
