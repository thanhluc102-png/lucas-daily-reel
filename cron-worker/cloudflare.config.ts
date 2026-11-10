import { defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// Hẹn giờ đăng bài cho repo lucas-daily-reel (xem src/index.ts và README.md).
// Giờ cron là UTC: VN = UTC + 7. Mỗi cron phải có việc tương ứng trong JOBS (src/index.ts).
// Worker không mở URL nào (workersDev, previewUrls tắt), nên chỉ chạy theo lịch.
export default defineConfig({
	worker: {
		name: "lucas-reel-cron",
		compatibilityDate: "2026-11-04",
		entrypoint,
		workersDev: false,
		previewUrls: false,
		observability: { enabled: true },
		triggers: [
			triggers.scheduled({ schedule: "30 1 * * *" }), // 08:30 VN: Daily reel v2
			triggers.scheduled({ schedule: "15 11 * * *" }), // 18:15 VN: video sản phẩm web
			triggers.scheduled({ schedule: "*/5 * * * *" }), // TẠM: thử token bằng lượt dry-run, gỡ sau khi thử xong
		],
	},
});
