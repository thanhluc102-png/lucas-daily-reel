#!/usr/bin/env node
/**
 * Khớp mốc thời gian từ words.json vào từng cảnh, rồi dựng cue phụ đề karaoke.
 *
 *   node scripts/align.mjs jobs/2026-07-22_57586.json
 *
 * Đây là bước quan trọng nhất của phần phụ đề. Ý tưởng:
 * thời lượng cảnh trong kịch bản chỉ là DỰ TÍNH. Sau khi có giọng đọc thật,
 * ta đo lại theo chính file audio đó. Nhờ vậy chữ luôn khớp tiếng, không bao giờ
 * lệch — kể cả khi giọng đọc nhanh chậm khác dự tính.
 */

import fs from 'node:fs';
import path from 'node:path';

const MAX_LINE_CHARS = 22; // theo rules/visual.md
const MAX_LINES_PER_CUE = 2;

const file = process.argv[2];
if (!file) {
  console.error('Dùng: node scripts/align.mjs jobs/<id>.json');
  process.exit(2);
}

const job = JSON.parse(fs.readFileSync(file, 'utf8'));
const dir = path.join(path.dirname(file), path.basename(file, '.json'));
const wordsPath = job.subtitle?.words_path || path.join(dir, 'words.json');

if (!fs.existsSync(wordsPath)) {
  console.error(`Không thấy ${wordsPath}. Chạy whisper_words.py trước.`);
  process.exit(2);
}

const heard = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));

// --- so khớp chữ ------------------------------------------------------------

const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,!?;:"'“”‘’()\[\]…\-–—]/g, '')
    .trim();

function lev(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return dp[a.length][b.length];
}

const similar = (a, b) => {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return lev(a, b) <= 1;
};

// Danh sách chữ mong đợi, kèm cảnh nào
const expected = [];
job.scenes.forEach((s, si) => {
  for (const tok of s.text.split(/\s+/)) {
    const n = norm(tok);
    if (n) expected.push({ n, raw: tok, scene: si });
  }
});

// Căn chuỗi bằng LCS (quy hoạch động hai chiều) thay vì duyệt tham lam.
// Giọng đọc hay CHÈN thêm chữ ở tên riêng (WIWU Salem → "ui u say lầm",
// YKK → "ít", da PU → "gia tu"). Con trỏ tham lam chỉ tiến khi khớp nên kẹt
// cứng ở cụm méo rồi trượt hết phần sau — dù các cảnh sau đọc đúng.
// LCS bỏ qua được chữ thừa/thiếu ở CẢ HAI phía rồi tự bắt nhịp lại.
const H = heard.map((h) => norm(h.w));
const n = expected.length;
const m = H.length;

const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
for (let i = n - 1; i >= 0; i--) {
  for (let k = m - 1; k >= 0; k--) {
    dp[i][k] = similar(expected[i].n, H[k])
      ? dp[i + 1][k + 1] + 1
      : Math.max(dp[i + 1][k], dp[i][k + 1]);
  }
}

let matched = 0;
for (let i = 0, k = 0; i < n && k < m; ) {
  if (similar(expected[i].n, H[k])) {
    expected[i].start = heard[k].start;
    expected[i].end = heard[k].end;
    expected[i].p = heard[k].p;
    matched++;
    i++;
    k++;
  } else if (dp[i + 1][k] >= dp[i][k + 1]) {
    i++;
  } else {
    k++;
  }
}

const rate = matched / expected.length;
if (rate < 0.6) {
  console.error(
    `\x1b[31m✖\x1b[0m Chỉ khớp ${(rate * 100).toFixed(0)}% số chữ — giọng đọc có vẻ không đúng kịch bản này.`
  );
  console.error('  Kiểm tra voice.mp3 có phải của job này không, rồi chạy lại.');
  process.exit(1);
}

// --- nội suy mốc cho chữ không khớp ----------------------------------------
// Tên riêng méo (WIWU, Salem, YKK, PU, lucas.vn) không khớp được nên thiếu mốc.
// Nếu chỉ dựng cue từ chữ khớp thì phụ đề RỚT nguyên các chữ đó — đọc sai chính tả.
// Ở đây điền mốc bằng nội suy tuyến tính giữa hai chữ khớp gần nhất; CHỮ giữ
// nguyên spelling kịch bản (exp.raw), chỉ thời điểm là ước lượng.
for (let i = 0; i < expected.length; i++) {
  if (expected[i].start !== undefined) continue;
  let runEnd = i;
  while (runEnd + 1 < expected.length && expected[runEnd + 1].start === undefined) runEnd++;
  const count = runEnd - i + 1;

  let a = i - 1;
  while (a >= 0 && expected[a].end === undefined) a--;
  let b = runEnd + 1;
  while (b < expected.length && expected[b].start === undefined) b++;

  const left = a >= 0 ? expected[a].end : (b < expected.length ? expected[b].start - 0.25 * count : 0);
  const right = b < expected.length ? expected[b].start : left + 0.25 * count;
  const step = (right - left) / (count + 1);

  for (let r = 0; r < count; r++) {
    const s = left + step * (r + 1);
    expected[i + r].start = Number(s.toFixed(3));
    expected[i + r].end = Number((s + Math.max(0.12, step * 0.9)).toFixed(3));
    expected[i + r].p = 0; // 0 = mốc nội suy, không phải nghe được
  }
  i = runEnd;
}

// --- đo lại thời lượng từng cảnh -------------------------------------------

const report = [];
let cursor = 0;

job.scenes.forEach((s, si) => {
  const own = expected.filter((e) => e.scene === si && e.start !== undefined);

  if (!own.length) {
    console.warn(`  ▲ cảnh ${si}: không khớp được chữ nào, giữ thời lượng dự tính`);
    s.start_sec = Number(cursor.toFixed(3));
    s.end_sec = Number((cursor + s.duration_sec).toFixed(3));
    cursor = s.end_sec;
    return;
  }

  const start = Math.min(...own.map((e) => e.start));
  const end = Math.max(...own.map((e) => e.end));

  s.start_sec = Number(Math.max(cursor, start - 0.12).toFixed(3)); // chừa 120ms trước câu
  s.end_sec = Number((end + 0.18).toFixed(3)); // ngân 180ms sau câu
  const measured = s.end_sec - s.start_sec;

  report.push({ si, planned: s.duration_sec, measured: Number(measured.toFixed(2)) });
  s.duration_sec = Number(measured.toFixed(3));
  cursor = s.end_sec;
});

// --- dựng cue phụ đề --------------------------------------------------------

const cues = [];

job.scenes.forEach((s, si) => {
  const own = expected.filter((e) => e.scene === si && e.start !== undefined);
  if (!own.length) return;

  // Chia đều thành N cue thay vì cắt tham lam.
  // Cắt tham lam hay để lại một chữ lẻ ở cue cuối, nhấp nháy 0.3s trông rất tệ.
  const totalChars = own.reduce((a, w) => a + w.raw.length + 1, 0) - 1;
  // Chừa ~6 ký tự dư so với trần 2×22: nhắm sát 44 thì biên từ hay không cho
  // cắt được cả hai dòng ≤22 (vd "…phần trăm, giờ còn 450K thôi." kẹt ở 19|24).
  const perCue = MAX_LINE_CHARS * MAX_LINES_PER_CUE - 6;
  const nCues = Math.max(1, Math.ceil(totalChars / perCue));
  const target = totalChars / nCues;

  const groups = [];
  let cur = [];
  let curLen = 0;

  for (const w of own) {
    const add = w.raw.length + (cur.length ? 1 : 0);
    const remainingCues = nCues - groups.length;
    if (cur.length && curLen + add > target && remainingCues > 1) {
      groups.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(w);
    curLen += add;
  }
  if (cur.length) groups.push(cur);

  for (const flat of groups) {
    // chia cue thành tối đa 2 dòng, cắt gần giữa cho cân
    const chars = flat.reduce((a, w) => a + w.raw.length + 1, 0) - 1;
    const lines = [];

    if (chars <= MAX_LINE_CHARS) {
      lines.push(flat);
    } else {
      // Chọn điểm ngắt 2 dòng: ưu tiên KHÔNG dòng nào vượt MAX_LINE_CHARS
      // (rules/visual.md), sau đó mới cân cho hai dòng đều nhau.
      // Cắt theo "điểm giữa" như trước hay để lại dòng 25 ký tự, tràn khung.
      const lineLen = (arr) => arr.reduce((a, w, i) => a + w.raw.length + (i ? 1 : 0), 0);
      let best = null;
      for (let cut = 1; cut < flat.length; cut++) {
        const l1 = lineLen(flat.slice(0, cut));
        const l2 = lineLen(flat.slice(cut));
        const over = Math.max(0, l1 - MAX_LINE_CHARS) + Math.max(0, l2 - MAX_LINE_CHARS);
        const score = over * 100 + Math.abs(l1 - l2); // phạt nặng tràn, rồi tới lệch
        if (!best || score < best.score) best = { cut, score };
      }
      lines.push(flat.slice(0, best.cut), flat.slice(best.cut));
    }

    cues.push({
      scene: si,
      start: Number(flat[0].start.toFixed(3)),
      end: Number(flat.at(-1).end.toFixed(3)),
      lines: lines.map((ln) => ln.map((w) => w.raw).join(' ')),
      // mốc từng chữ để tô sáng kiểu karaoke
      words: flat.map((w) => ({
        w: w.raw,
        start: Number(w.start.toFixed(3)),
        end: Number(w.end.toFixed(3)),
      })),
    });
  }
});

// --- ghi lại ----------------------------------------------------------------

job.subtitle = {
  ...(job.subtitle || {}),
  style: job.subtitle?.style || 'karaoke',
  words_path: wordsPath,
  cues,
};
job.audio = { ...(job.audio || {}), measured_duration_sec: Number(cursor.toFixed(2)) };

fs.writeFileSync(file, JSON.stringify(job, null, 2));

// --- báo cáo ----------------------------------------------------------------

console.log(`\x1b[32m✔\x1b[0m khớp ${matched}/${expected.length} chữ (${(rate * 100).toFixed(0)}%)`);
console.log(`  ${cues.length} cue phụ đề, tổng ${cursor.toFixed(1)}s`);

const drift = report.filter((r) => Math.abs(r.measured - r.planned) > 1);
if (drift.length) {
  console.log('\n  Cảnh lệch nhiều so với dự tính:');
  for (const d of drift) {
    const sign = d.measured > d.planned ? '+' : '';
    console.log(`    cảnh ${d.si}: dự tính ${d.planned}s → thật ${d.measured}s (${sign}${(d.measured - d.planned).toFixed(1)}s)`);
  }
  console.log('  Đã lấy số đo thật. Nếu lệch quá nhiều thì viết lời ngắn/dài lại cho khớp nhịp.');
}

if (rate < 0.85) {
  console.log(`\n  ▲ Tỉ lệ khớp ${(rate * 100).toFixed(0)}% hơi thấp — phụ đề có thể lệch vài chỗ.`);
  console.log('    Thường do lời thoại có số, tên riêng tiếng Anh, hoặc từ viết tắt.');
}
