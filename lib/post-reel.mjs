#!/usr/bin/env node
// Đăng MP4 lên Facebook Page Reels — 3 phase: start -> upload -> finish.
// Tham chiếu: developers.facebook.com/docs/graph-api/reference/page/video_reels/
//
// Token page KHÔNG nằm trong repo. Đặt ở GitHub Secrets: FB_PAGE_TOKEN.
// Quyền cần: pages_manage_posts, pages_read_engagement, pages_show_list.
//
// Dùng: node lib/post-reel.mjs renders/reel.mp4

import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';

const CONFIG = JSON.parse(await readFile('config.json', 'utf8'));
const TOKEN = process.env.FB_PAGE_TOKEN;
const PAGE_ID = process.env.FB_PAGE_ID ?? CONFIG.pageId;
const DRY_RUN = process.env.DRY_RUN !== 'false';
const GRAPH = `https://graph.facebook.com/${CONFIG.graphVersion}`;

// Reels: > 3 giây, <= 60 giây, 9:16, MP4, tối thiểu 1080p.
const MIN_SECONDS = 3;

function buildCaption(data) {
  const lines = [
    data.name,
    '',
    `Giá: ${data.price}${data.onSale ? ` (thay vì ${data.regularPrice})` : ''}`,
    `Mua tại: ${data.permalink}`,
    'Hotline 0902 391 348 · 29/7 Hoàng Diệu, P.10, Phú Nhuận',
    '',
    CONFIG.hashtags,
  ];
  return lines.join('\n');
}

async function jsonOrThrow(res, step) {
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok || body.error) {
    throw new Error(`[${step}] HTTP ${res.status} — ${JSON.stringify(body.error ?? body)}`);
  }
  return body;
}

async function startUpload() {
  const res = await fetch(`${GRAPH}/${PAGE_ID}/video_reels?upload_phase=start`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${TOKEN}` },
  });
  return jsonOrThrow(res, 'start'); // -> { video_id, upload_url }
}

async function uploadBinary(uploadUrl, filePath, fileSize) {
  // rupload.facebook.com nhận raw binary. Không phải multipart.
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${TOKEN}`,
      offset: '0',
      file_size: String(fileSize),
      'Content-Type': 'application/octet-stream',
    },
    body: createReadStream(filePath),
    duplex: 'half', // Node 18+ bắt buộc khi body là stream
  });
  return jsonOrThrow(res, 'upload');
}

async function finish(videoId, description) {
  const params = new URLSearchParams({
    upload_phase: 'finish',
    video_id: videoId,
    video_state: 'PUBLISHED',
    description,
  });
  const res = await fetch(`${GRAPH}/${PAGE_ID}/video_reels?${params}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${TOKEN}` },
  });
  return jsonOrThrow(res, 'finish');
}

async function pollStatus(videoId, tries = 12) {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`${GRAPH}/${videoId}?fields=status&access_token=${TOKEN}`);
    const body = await jsonOrThrow(res, 'status');
    const phase = body.status?.video_status ?? body.status?.uploading_phase?.status;
    console.log(`  status[${i}] ${JSON.stringify(body.status)}`);
    if (phase === 'ready' || phase === 'published') return body;
    if (phase === 'error') throw new Error(`Meta báo lỗi xử lý: ${JSON.stringify(body.status)}`);
  }
  console.warn('  hết lượt poll, Meta vẫn đang xử lý — kiểm tra thủ công trên page');
}

const filePath = process.argv[2] ?? 'renders/reel.mp4';
const data = JSON.parse(await readFile('build/data.json', 'utf8'));
const { size } = await stat(filePath);
const caption = buildCaption(data);

console.log(`file    ${filePath}  (${(size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`caption\n${caption.split('\n').map((l) => '  | ' + l).join('\n')}`);

if (DRY_RUN) {
  console.log('\nDRY_RUN=true — không đăng gì hết. Đặt DRY_RUN=false để đăng thật.');
  process.exit(0);
}
if (!TOKEN) throw new Error('Thiếu FB_PAGE_TOKEN trong environment');
if (!PAGE_ID || PAGE_ID.startsWith('PUT_')) throw new Error('Chưa điền pageId trong config.json');

console.log('\nphase 1  start');
const { video_id, upload_url } = await startUpload();
console.log(`         video_id=${video_id}`);

console.log('phase 2  upload');
await uploadBinary(upload_url, filePath, size);

console.log('phase 3  finish');
await finish(video_id, caption);

console.log('poll     đợi Meta xử lý');
await pollStatus(video_id);
console.log(`\nxong  https://facebook.com/${video_id}`);
