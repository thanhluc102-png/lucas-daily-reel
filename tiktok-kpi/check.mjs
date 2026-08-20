#!/usr/bin/env node
/**
 * Tự chấm điểm KPI kênh TikTok từ số liệu công khai (follower, tổng lượt thích, số video).
 * Không cần đăng nhập, không cần ai nhập số tay — chỉ đọc trang public.
 *
 * Chạy: node tiktok-kpi/check.mjs <handle>
 * Không truyền handle thì chạy hết các kênh khai báo trong config.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(dir, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

async function fetchStats(handle) {
  const res = await fetch(`https://www.tiktok.com/@${handle}`, {
    headers: { 'User-Agent': UA },
  });
  const html = await res.text();

  const grab = (key) => {
    const m = html.match(new RegExp(`"${key}":(\\d+)`));
    return m ? Number(m[1]) : null;
  };

  const follower = grab('followerCount');
  const heart = grab('heartCount') ?? grab('heart');
  const videoCount = grab('videoCount');

  if (follower == null || heart == null || videoCount == null) {
    throw new Error(`Không đọc được số liệu công khai cho @${handle} — trang có thể đã đổi cấu trúc hoặc bị chặn.`);
  }
  return { follower, heart, videoCount };
}

function scoreChannel(prev, curr, cfg, historyBeforePrev) {
  const growthPct = prev.follower > 0 ? ((curr.follower - prev.follower) / prev.follower) * 100 : 0;
  const score1 = clamp(50 + growthPct * 5, 0, 150);

  const videosThis = Math.max(0, curr.videoCount - prev.videoCount);
  const ratio = cfg.postsRequired > 0 ? clamp(videosThis / cfg.postsRequired, 0, 1) : 1;
  const score2 = ratio * 100;

  const heartsThis = Math.max(0, curr.heart - prev.heart);
  // nền = trung bình tăng-lượt-thích của tối đa 3 kỳ trước (bao gồm kỳ prev->curr hiện đang xét nếu chưa có gì khác)
  const priorDeltas = [];
  const chain = [...(historyBeforePrev || []), prev];
  for (let i = 1; i < chain.length; i++) {
    priorDeltas.push(Math.max(0, chain[i].heart - chain[i - 1].heart));
  }
  const baselineHearts = priorDeltas.length
    ? priorDeltas.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, priorDeltas.length)
    : heartsThis; // kỳ đầu tiên có delta: chưa có nền, tự so với chính nó -> điểm trung tính

  const deltaHeartPct = baselineHearts > 0 ? ((heartsThis - baselineHearts) / baselineHearts) * 100 : 0;
  const score3 = clamp(50 + deltaHeartPct * 2, 0, 150);

  const violation = !!cfg.violationThisPeriod;
  const totalScore = violation ? 0 : 0.3 * score1 + 0.25 * score2 + 0.45 * score3;

  const base = cfg.baseSalary ?? 2000000;
  const targetBonus = cfg.targetBonus ?? 1000000;
  let bonus = 0;
  if (!violation) {
    bonus = totalScore <= 100
      ? (totalScore / 100) * targetBonus
      : targetBonus + ((totalScore - 100) / 100) * targetBonus * 0.2;
  }
  const payout = Math.round(base + bonus);

  return {
    growthPct: Number(growthPct.toFixed(2)),
    videosThis,
    heartsThis,
    baselineHearts: Number(baselineHearts.toFixed(1)),
    score1: Number(score1.toFixed(1)),
    score2: Number(score2.toFixed(1)),
    score3: Number(score3.toFixed(1)),
    totalScore: violation ? 0 : Number(totalScore.toFixed(1)),
    violation,
    base,
    bonus: Math.round(bonus),
    payout,
  };
}

async function runOne(handle) {
  const cfg = config.channels[handle];
  if (!cfg) throw new Error(`Không thấy cấu hình cho kênh "${handle}" trong config.json`);

  const historyPath = path.join(dir, `history_${handle}.json`);
  const history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath, 'utf8')) : [];

  const stats = await fetchStats(handle);
  const today = new Date().toISOString().slice(0, 10);

  let entry = { date: today, ...stats, score: null, payout: null, note: null };

  if (history.length > 0) {
    const prev = history[history.length - 1];
    const result = scoreChannel(prev, stats, cfg, history.slice(0, -1));
    entry.score = result.totalScore;
    entry.payout = result.payout;
    entry.detail = result;
    entry.note = result.violation
      ? 'Vi phạm quy tắc thương hiệu trong kỳ — khoá thưởng biến đổi.'
      : null;

    console.log(`\n=== ${cfg.displayName} (@${handle}) — ${today} ===`);
    console.log(`Follower: ${prev.follower} → ${stats.follower}  (${result.growthPct >= 0 ? '+' : ''}${result.growthPct}%)`);
    console.log(`Video đăng kỳ này: ${result.videosThis} / ${cfg.postsRequired} yêu cầu`);
    console.log(`Lượt thích tăng thêm: +${result.heartsThis}  (nền tham chiếu ~${result.baselineHearts})`);
    console.log(`Điểm nhóm — Follower ${result.score1} | Vận hành ${result.score2} | Tương tác ${result.score3}`);
    console.log(`>>> Tổng điểm: ${result.totalScore}/100${result.violation ? '  [VI PHẠM — khoá thưởng]' : ''}`);
    console.log(`>>> Trả kỳ này: ${result.payout.toLocaleString('vi-VN')}đ  (cứng ${result.base.toLocaleString('vi-VN')}đ + thưởng ${result.bonus.toLocaleString('vi-VN')}đ)`);
  } else {
    console.log(`\n=== ${cfg.displayName} (@${handle}) — ${today} ===`);
    console.log('Mốc khởi tạo đầu tiên, chưa có kỳ trước để so sánh. Chưa chấm điểm.');
    console.log(`Follower ${stats.follower} · Tổng lượt thích ${stats.heart} · ${stats.videoCount} video`);
  }

  history.push(entry);
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 2) + '\n');

  // reset cờ vi phạm sau khi đã tính cho kỳ này, để kỳ sau mặc định sạch
  if (cfg.violationThisPeriod) {
    cfg.violationThisPeriod = false;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  return entry;
}

async function main() {
  const handleArg = process.argv[2];
  const handles = handleArg ? [handleArg] : Object.keys(config.channels);
  for (const h of handles) {
    try {
      await runOne(h);
    } catch (e) {
      console.error(`Lỗi với kênh ${h}:`, e.message);
      process.exitCode = 1;
    }
  }
}

main();
