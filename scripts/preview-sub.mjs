#!/usr/bin/env node
/**
 * Xem trước phụ đề trong trình duyệt, không cần render video.
 *
 *   node scripts/preview-sub.mjs jobs/<id>.json
 *   → tạo jobs/<id>/preview.html, mở bằng trình duyệt
 *
 * Dùng để chỉnh cỡ chữ, vị trí, màu trước khi tốn thời gian render.
 */

import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('Dùng: node scripts/preview-sub.mjs jobs/<id>.json');
  process.exit(2);
}

const job = JSON.parse(fs.readFileSync(file, 'utf8'));
const cues = job.subtitle?.cues;

if (!cues?.length) {
  console.error('Job chưa có subtitle.cues. Chạy scripts/align.mjs trước.');
  process.exit(2);
}

const dir = path.join(path.dirname(file), path.basename(file, '.json'));
fs.mkdirSync(dir, { recursive: true });

const component = fs.readFileSync(
  path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'templates', 'subtitle.mjs'),
  'utf8'
);

const voiceRel = job.audio?.voice_path ? path.relative(dir, job.audio.voice_path) : null;
const total = job.audio?.measured_duration_sec || cues.at(-1).end + 1;
const bg = job.brand?.bg || '#0B1B2E';
const accent = job.brand?.accent || '#C9A227';

const html = `<!doctype html>
<meta charset="utf-8">
<title>Xem trước phụ đề — ${job.job_id}</title>
<style>
  body { margin:0; background:#111; display:flex; gap:24px; padding:24px;
         font-family:system-ui,sans-serif; color:#ccc; }
  #stage { position:relative; width:405px; height:720px; background:${bg};
           border-radius:14px; overflow:hidden; flex:none;
           box-shadow:0 20px 60px rgba(0,0,0,.5); }
  /* khung thật 1080x1920, thu nhỏ để xem */
  #frame { position:absolute; top:0; left:0; width:1080px; height:1920px;
           transform:scale(0.375); transform-origin:top left; }
  .safe { position:absolute; left:0; right:0; border:1px dashed rgba(255,255,255,.18); }
  .safe.top { top:0; height:220px; }
  .safe.bot { bottom:0; height:320px; }
  #panel { flex:1; max-width:520px; }
  button { background:${accent}; border:0; color:#0B1B2E; font-weight:700;
           padding:10px 18px; border-radius:8px; cursor:pointer; font-size:15px; }
  input[type=range] { width:100%; margin:16px 0 8px; }
  code { background:#222; padding:2px 6px; border-radius:4px; }
  .row { margin:14px 0; font-size:14px; line-height:1.6; }
</style>

<div id="stage">
  <div id="frame">
    <div class="safe top"></div>
    <div class="safe bot"></div>
  </div>
</div>

<div id="panel">
  <h2 style="color:#fff;margin:0 0 4px">${job.title || job.job_id}</h2>
  <div class="row">${cues.length} cue · ${total.toFixed(1)} giây</div>
  <button id="play">▶ Chạy</button>
  <input type="range" id="seek" min="0" max="${total}" step="0.02" value="0">
  <div class="row"><code id="t">0.00s</code></div>
  <div class="row" style="color:#888">
    Vạch đứt là vùng an toàn — UI của TikTok/Reels che chỗ đó.
    Chữ không được chạm vào hai dải này.
  </div>
  ${voiceRel ? `<audio id="a" src="${voiceRel}"></audio>` : '<div class="row" style="color:#a66">Chưa có file giọng đọc — chỉ xem hình.</div>'}
</div>

<script type="module">
${component}

const cues = ${JSON.stringify(cues)};
const frame = document.getElementById('frame');
const sub = mountSubtitles(frame, cues, { accent: '${accent}' });

const seek = document.getElementById('seek');
const tEl  = document.getElementById('t');
const audio = document.getElementById('a');
let playing = false, t0 = 0, raf;

function show(t) {
  sub.seek(t);
  tEl.textContent = t.toFixed(2) + 's';
  seek.value = t;
}

function loop() {
  const t = (performance.now() - t0) / 1000;
  if (t > ${total}) { stop(); show(0); return; }
  show(t);
  raf = requestAnimationFrame(loop);
}

function stop() {
  playing = false;
  cancelAnimationFrame(raf);
  document.getElementById('play').textContent = '▶ Chạy';
  if (audio) audio.pause();
}

document.getElementById('play').onclick = () => {
  if (playing) return stop();
  playing = true;
  document.getElementById('play').textContent = '⏸ Dừng';
  t0 = performance.now() - Number(seek.value) * 1000;
  if (audio) { audio.currentTime = Number(seek.value); audio.play(); }
  loop();
};

seek.oninput = () => { stop(); show(Number(seek.value)); };
show(0);
</script>
`;

const out = path.join(dir, 'preview.html');
fs.writeFileSync(out, html);
console.log(`\x1b[32m✔\x1b[0m ${out}`);
console.log(`\nMở bằng:  open ${out}`);
