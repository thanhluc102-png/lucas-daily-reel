#!/usr/bin/env node
// Chốt chặn chống đăng trùng.
//
// Workflow đặt nhiều mốc cron trong buổi sáng, phòng khi GitHub bỏ nhịp đầu.
// Nhưng nếu cả ba nhịp đều chạy thì thành ba reel một ngày. Script này đọc
// history.json, so ngày của bản ghi mới nhất với hôm nay theo giờ Việt Nam.
//
// history.json chỉ được commit sau khi ĐĂNG THÀNH CÔNG. Nên nếu lần chạy trước
// hỏng giữa chừng, hôm nay vẫn còn trống, và nhịp sau được phép chạy lại.

import { readFile } from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh',
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date()); // -> "2026-07-09"

let last = null;
if (existsSync('history.json')) {
  const h = JSON.parse(await readFile('history.json', 'utf8'));
  last = h.used?.[0] ?? null;
}

const alreadyPosted = last?.at === today;

console.log(`hôm nay (giờ VN): ${today}`);
console.log(`lần quay gần nhất: ${last ? `${last.at}  product ${last.id}` : 'chưa có'}`);
console.log(alreadyPosted ? '=> đã đăng hôm nay, bỏ qua lần chạy này' : '=> chưa đăng, chạy tiếp');

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `skip=${alreadyPosted}\n`);
}
