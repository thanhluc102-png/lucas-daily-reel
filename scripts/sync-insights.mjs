#!/usr/bin/env node
/**
 * Đồng bộ tương tác Facebook cho từng reel đã đăng -> reels_history.json.
 * Chạy sau khi đăng (trong workflow). Cần FB_PAGE_TOKEN + FB_PAGE_ID.
 *
 * Với mỗi post <7 ngày tuổi, kéo reactions/comments/shares rồi tính Score
 * (reactions*1 + comments*3 + shares*5) — Share nặng nhất vì khó đạt nhất.
 */
import { readFile, writeFile } from 'node:fs/promises';

const TOKEN = process.env.FB_PAGE_TOKEN;
const PAGE_ID = process.env.FB_PAGE_ID;
const GRAPH = 'https://graph.facebook.com/v25.0';
const FILE = 'reels_history.json';

async function engagement(postId) {
  for (const pid of [postId, `${PAGE_ID}_${postId}`]) {
    const url = `${GRAPH}/${pid}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(TOKEN)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const j = await res.json();
      const reactions = j.reactions?.summary?.total_count || 0;
      const comments = j.comments?.summary?.total_count || 0;
      const shares = j.shares?.count || 0;
      return { reactions, comments, shares, score: reactions + comments * 3 + shares * 5 };
    } catch (e) {
      console.error(`fetch stats ${pid}: ${e.message}`);
    }
  }
  return null;
}

async function main() {
  if (!TOKEN) { console.log('Thiếu FB_PAGE_TOKEN — bỏ qua sync.'); return; }
  let history;
  try { history = JSON.parse(await readFile(FILE, 'utf8')); }
  catch { console.log('Chưa có reels_history.json — bỏ qua.'); return; }
  if (!Array.isArray(history)) { console.log('reels_history.json không phải mảng.'); return; }

  const now = Date.now();
  let updated = false;
  for (const e of history) {
    if (!e.post_id || !e.publish_time) continue;
    const ageDays = (now - new Date(e.publish_time).getTime()) / 86400000;
    if (ageDays >= 7) continue;
    const stats = await engagement(e.post_id);
    if (stats) {
      e.performance = stats;
      updated = true;
      console.log(`  ${e.post_id} (${e.product_name || ''}): L${stats.reactions} C${stats.comments} S${stats.shares} → Score ${stats.score}`);
    }
  }
  if (updated) {
    await writeFile(FILE, JSON.stringify(history, null, 2), 'utf8');
    console.log('Đã lưu reels_history.json.');
  } else {
    console.log('Không có post nào <7 ngày để cập nhật.');
  }
}
main().catch((e) => { console.error(e); process.exit(0); });
