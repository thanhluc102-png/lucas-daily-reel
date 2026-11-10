// lucas-reel-cron: đến giờ thì nhờ GitHub chạy ngay workflow đăng bài của repo lucas-daily-reel.
//
// Giờ hẹn (cron) của GitHub ở repo này hay trễ 6–8 tiếng, có lượt còn bị bỏ.
// Lệnh "chạy ngay" (workflow_dispatch) thì GitHub chạy liền, nên Cloudflare canh giờ thay.
// Worker không tự đăng gì. Khóa an toàn nằm trong chính các workflow:
//   - daily-reel-v2.yml: guard=true -> các bài cách nhau ít nhất 14 tiếng, như lượt cron;
//   - drip-web.yml: chỉ đăng trong khung 17:45–21:30, tối đa 1 bài/ngày, theo post_after.
// Lịch cron cũ của GitHub vẫn giữ làm dự phòng. Gọi trùng thì workflow tự bỏ qua.

interface Env {
	// Fine-grained token: chỉ repo lucas-daily-reel, quyền "Actions: Read and write".
	// Thầy Lực tự dán trong Cloudflare (Settings → Variables and Secrets), không lưu ở đây.
	GITHUB_TOKEN?: string;
}

const REPO = "thanhluc102-png/lucas-daily-reel";

type Job = { label: string; workflow: string; inputs: Record<string, string> };

// Khóa là biểu thức cron (giờ UTC) khai trong cloudflare.config.ts. Giờ VN = UTC + 7.
const JOBS: Record<string, Job> = {
	"30 1 * * *": {
		label: "08:30 VN · Daily reel v2",
		workflow: "daily-reel-v2.yml",
		inputs: { dry_run: "false", guard: "true" },
	},
	"15 11 * * *": {
		label: "18:15 VN · video sản phẩm web",
		workflow: "drip-web.yml",
		inputs: { dry_run: "false" },
	},
	// TẠM: thử token. dry_run=true chỉ in caption, không đăng. Gỡ sau khi thử xong.
	"*/5 * * * *": {
		label: "THỬ · drip-web dry-run",
		workflow: "drip-web.yml",
		inputs: { dry_run: "true" },
	},
};

export default {
	async scheduled(controller, env) {
		const job = JOBS[controller.cron];
		if (!job) throw new Error(`Không có việc nào cho cron "${controller.cron}"`);
		if (!env.GITHUB_TOKEN) throw new Error("Thiếu secret GITHUB_TOKEN");
		await dispatch(env.GITHUB_TOKEN, job);
	},
} satisfies ExportedHandler<Env>;

async function dispatch(token: string, job: Job): Promise<void> {
	const url = `https://api.github.com/repos/${REPO}/actions/workflows/${job.workflow}/dispatches`;
	const init: RequestInit = {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "lucas-reel-cron",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ ref: "main", inputs: job.inputs }),
	};
	let last = "";
	for (let attempt = 1; attempt <= 4; attempt++) {
		try {
			const res = await fetch(url, init);
			if (res.ok) {
				console.log(`${job.label}: đã nhờ GitHub chạy ${job.workflow} (HTTP ${res.status})`);
				return;
			}
			last = `HTTP ${res.status} ${(await res.text()).slice(0, 300)}`;
			// 401/403/404/422 là sai token, thiếu quyền hoặc sai input: thử lại cũng vô ích.
			if (res.status < 500 && res.status !== 429) break;
		} catch (err) {
			last = String(err);
		}
		console.warn(`${job.label}: lần ${attempt} lỗi: ${last}`);
		await new Promise((resolve) => setTimeout(resolve, attempt * 20_000));
	}
	throw new Error(`${job.label}: không nhờ được GitHub chạy ${job.workflow}: ${last}`);
}
