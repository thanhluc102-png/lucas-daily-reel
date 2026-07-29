#!/usr/bin/env node
/**
 * QC — kiểm video cuối trước khi giao.
 *
 *   node scripts/qc.mjs jobs/<id>/final.mp4 [jobs/<id>.json]
 *
 * Thoát 0 = PASS. Thoát 1 = FAIL (sửa rồi render lại).
 * Kiểm bằng ffprobe: đúng 1080x1920, có tiếng, thời lượng hợp lệ, không vỡ file.
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const mp4 = process.argv[2];
const jobFile = process.argv[3];
if (!mp4) {
  console.error('Dùng: node scripts/qc.mjs jobs/<id>/final.mp4 [jobs/<id>.json]');
  process.exit(2);
}
if (!fs.existsSync(mp4)) {
  console.error(`Không thấy file: ${mp4}`);
  process.exit(1);
}

const probe = JSON.parse(
  execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', mp4], { encoding: 'utf8' })
);

const v = probe.streams.find((s) => s.codec_type === 'video');
const a = probe.streams.find((s) => s.codec_type === 'audio');
const dur = Number(probe.format.duration);
const mb = Number(probe.format.size) / 1024 / 1024;

const fails = [];
const warns = [];

if (!v) fails.push('không có luồng video');
else {
  if (v.width !== 1080 || v.height !== 1920)
    fails.push(`độ phân giải ${v.width}x${v.height}, cần 1080x1920 (9:16)`);
  if (v.pix_fmt && v.pix_fmt !== 'yuv420p')
    warns.push(`pix_fmt=${v.pix_fmt} — nhiều nền tảng thích yuv420p`);
}

if (!a) fails.push('không có tiếng (thiếu audio track)');

// thời lượng: editorial cho 15–60s, ngọt nhất 22–35s
if (!(dur > 0)) fails.push('thời lượng = 0, file hỏng');
else {
  if (dur < 12) fails.push(`chỉ ${dur.toFixed(1)}s — quá ngắn`);
  else if (dur > 65) fails.push(`${dur.toFixed(1)}s — quá dài (>60s)`);
  else if (dur < 15 || dur > 60) warns.push(`${dur.toFixed(1)}s — ngoài khoảng 15–60s`);
}

if (mb < 0.3) fails.push(`file chỉ ${mb.toFixed(1)}MB — nghi render hỏng`);

// đối chiếu với kịch bản nếu có
if (jobFile && fs.existsSync(jobFile)) {
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  const want = job.audio?.measured_duration_sec;
  if (want && Math.abs(want - dur) > 1.5)
    warns.push(`video ${dur.toFixed(1)}s lệch >1.5s so với kịch bản ${want}s`);
  if (job.audio?.draft)
    warns.push('giọng đọc là bản NHÁP (macOS say) — thêm ELEVENLABS_API_KEY cho bản đăng');
}

const name = mp4.split('/').pop();
console.log(`Video: ${name}`);
console.log(`  ${v?.width}x${v?.height} · ${dur?.toFixed(1)}s · ${mb.toFixed(1)}MB · video=${v?.codec_name} audio=${a?.codec_name || 'KHÔNG'}`);

for (const f of fails) console.log(`  \x1b[31mFAIL\x1b[0m ${f}`);
for (const w of warns) console.log(`  \x1b[33mnhắc\x1b[0m ${w}`);

if (fails.length) {
  console.log(`\n\x1b[31m✖ QC FAIL\x1b[0m — ${fails.length} lỗi, sửa rồi render lại.`);
  process.exit(1);
}
console.log(`\n\x1b[32m✔ QC PASS\x1b[0m${warns.length ? ` (có ${warns.length} nhắc nhở)` : ''}`);
