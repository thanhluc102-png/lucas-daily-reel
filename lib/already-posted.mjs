#!/usr/bin/env node
// Chốt chặn giãn cách — đăng cách nhau tối thiểu N giờ.
//
// Cron đặt 4 mốc cách nhau 6 tiếng. Guard này bảo đảm chỉ đăng khi lần đăng
// gần nhất đã cách >= MIN_HOURS (mặc định 5.5h) — vừa cho phép nhịp 6h chạy,
// vừa chặn double-post nếu GitHub lỡ bắn trùng nhịp.
//
// history.json chỉ được commit sau khi ĐĂNG THÀNH CÔNG, và `at` là mốc thời gian
// ISO đầy đủ. Lần chạy hỏng giữa chừng không ghi sổ -> nhịp sau được chạy lại.

import { readFile } from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';

const MIN_HOURS = Number(process.env.POST_MIN_HOURS ?? 5.5);

let last = null;
if (existsSync('history.json')) {
  const h = JSON.parse(await readFile('history.json', 'utf8'));
  last = h.used?.[0] ?? null;
}

const lastMs = last?.at ? new Date(last.at).getTime() : 0;
const hoursSince = lastMs ? (Date.now() - lastMs) / 3600000 : Infinity;
const skip = hoursSince < MIN_HOURS;

console.log(`lần đăng gần nhất: ${last?.at ?? 'chưa có'}` +
  `${Number.isFinite(hoursSince) ? `  (${hoursSince.toFixed(1)}h trước)` : ''}`);
console.log(skip
  ? `=> mới đăng < ${MIN_HOURS}h, bỏ qua nhịp này`
  : `=> đã cách >= ${MIN_HOURS}h, chạy tiếp`);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `skip=${skip}\n`);
}
