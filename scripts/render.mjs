#!/usr/bin/env node
/**
 * RENDER — dựng mp4 9:16 từ scenes.json.
 *
 *   node scripts/render.mjs jobs/<id>.json
 *   → jobs/<id>/final.mp4
 *
 * Cách làm: dựng một trang HTML 1080x1920 (ảnh sản phẩm + badge giá + phụ đề
 * karaoke từ templates/subtitle.mjs), rồi CHỤP TỪNG FRAME bằng Puppeteer theo
 * một đồng hồ ảo — không quay realtime. Nhờ vậy phụ đề khớp tiếng frame-chính-xác,
 * không phụ thuộc máy nhanh hay chậm. Frame đẩy thẳng vào ffmpeg để mã hoá.
 *
 * Chạy sau align.mjs (cần scenes[].start_sec/end_sec + subtitle.cues).
 * Nếu có jobs/<id>/voice.mp3 sẽ ghép giọng; luôn ghép nhạc nền assets/bgm.mp4.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const FPS = 30;
const W = 1080;
const H = 1920;
const FADE = 0.25; // giây crossfade giữa các cảnh

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const file = process.argv[2];
if (!file) {
  console.error('Dùng: node scripts/render.mjs jobs/<id>.json');
  process.exit(2);
}

// --- tìm Chrome cho puppeteer-core ------------------------------------------
function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const cache = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(cache)) {
    const builds = fs.readdirSync(cache).sort().reverse();
    for (const b of builds) {
      const app = path.join(cache, b, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
      if (fs.existsSync(app)) return app;
      const lin = path.join(cache, b, 'chrome-linux64', 'chrome');
      if (fs.existsSync(lin)) return lin;
    }
  }
  for (const p of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ]) if (fs.existsSync(p)) return p;
  throw new Error('Không tìm thấy Chrome. Set PUPPETEER_EXECUTABLE_PATH.');
}

// --- đọc job ----------------------------------------------------------------
const job = JSON.parse(fs.readFileSync(file, 'utf8'));
const dir = path.join(path.dirname(file), path.basename(file, '.json'));
fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });

const bg = job.brand?.bg || '#0B1B2E';
const accent = job.brand?.accent || '#C9A227';
const cues = job.subtitle?.cues || [];
const bySku = new Map((job.products || []).map((p) => [p.sku, p]));

// timeline từng cảnh: ưu tiên start_sec/end_sec do align.mjs đo; nếu chưa có thì cộng dồn duration
let cursor = 0;
const scenes = job.scenes.map((s) => {
  const start = s.start_sec ?? cursor;
  const end = s.end_sec ?? start + s.duration_sec;
  cursor = end;
  const prod = bySku.get(s.sku_ref) || job.products?.[0];
  return { ...s, start, end, prod };
});
const total = Number((job.audio?.measured_duration_sec || scenes.at(-1).end + 0.2).toFixed(3));

// --- tải ảnh sản phẩm -------------------------------------------------------
async function download(urlStr, dest) {
  const res = await fetch(urlStr, { headers: { 'User-Agent': 'lucas-daily-reel/1.0' } });
  if (!res.ok) throw new Error(`tải ảnh ${res.status}: ${urlStr}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error(`ảnh nghi hỏng (${buf.length}B): ${urlStr}`);
  fs.writeFileSync(dest, buf);
}

const imgMap = new Map(); // url -> local relative path
for (const s of scenes) {
  const src = s.asset?.src || s.prod?.image;
  if (!src) throw new Error(`cảnh ${s.idx}: không có ảnh (asset.src hoặc product.image)`);
  if (!imgMap.has(src)) {
    const name = `assets/img-${imgMap.size}.png`;
    process.stdout.write(`  tải ${src.slice(0, 60)}… `);
    await download(src, path.join(dir, name));
    console.log('ok');
    imgMap.set(src, name);
  }
  s._img = imgMap.get(src);
}

// --- font -------------------------------------------------------------------
fs.cpSync(path.join(root, 'assets', 'fonts'), path.join(dir, 'assets', 'fonts'), { recursive: true });
fs.copyFileSync(path.join(root, 'assets', 'logo.png'), path.join(dir, 'assets', 'logo.png'));

// --- dựng HTML --------------------------------------------------------------
const component = fs.readFileSync(path.join(root, 'templates', 'subtitle.mjs'), 'utf8');

const sceneLayers = scenes
  .map((s) => {
    const focusY = s.asset?.focus === 'top' ? '18%' : s.asset?.focus === 'bottom' ? '82%' : '50%';
    return `<div class="scene" data-i="${s.idx}" style="z-index:${s.idx + 1}">
      <div class="card"><img src="${s._img}" style="object-position:50% ${focusY}"></div>
    </div>`;
  })
  .join('\n');

// [V2] Nền động: chính ảnh sản phẩm phóng to + làm mờ + tối, đổi theo từng cảnh.
const ambientLayers = scenes
  .map((s) => `<div class="amb" data-i="${s.idx}" style="background-image:url(${s._img})"></div>`)
  .join('\n');

// [V2] Kinetic hook — BỘ PRESET chọn qua env HOOK_SPEC (JSON): stack | flash | slam | highlight.
// Không đặt = stack cho hook Bơm CP10. Bản chính: ai-copy tự điền style + highlight.
const hookEnd = scenes[1] ? scenes[1].start : 3.5;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hlWrap = (text, hls) => {
  let o = esc(text);
  (hls || []).forEach((h) => { o = o.split(esc(h)).join('<span class="hi">' + esc(h) + '</span>'); });
  return o;
};
// Nguồn cấu hình kinetic hook, ưu tiên: job.hook (do ai-copy điền: style + từ khoá)
// > env HOOK_SPEC (chạy tay) > TỰ TÁCH câu hook thành ~3 từ/dòng (mặc định an toàn).
function autoHookSpec() {
  const words = ((scenes[0] && scenes[0].text) || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  for (let i = 0; i < words.length; i += 3) lines.push(words.slice(i, i + 3).join(' '));
  // tránh dòng cuối trơ trọi 1 từ
  if (lines.length > 1 && lines[lines.length - 1].split(' ').length === 1)
    lines[lines.length - 2] += ' ' + lines.pop();
  return { style: 'stack', lines, hl: [] };
}
const HOOK_SPEC = job.hook || (process.env.HOOK_SPEC ? JSON.parse(process.env.HOOK_SPEC) : autoHookSpec());
function buildKhook(sp) {
  const st = sp.style || 'stack';
  if (st === 'flash') {
    const words = (sp.text || '').split(/\s+/).filter(Boolean);
    const hlset = new Set((sp.hl || []).join(' ').split(/\s+/).filter(Boolean));
    const inner = words.map((w, i) =>
      `<span class="fw${hlset.has(w.replace(/[?.,!]/g, '')) ? ' hi' : ''}" data-at="${(0.15 + i * 0.16).toFixed(2)}">${esc(w)}</span>`).join(' ');
    return `<div id="khook" class="flash"><div class="fl-wrap">${inner}</div></div>`;
  }
  if (st === 'slam') {
    return `<div id="khook" class="slam">
      <div class="sub" data-at="0.18">${(sp.pre || []).map(esc).join('<br>')}</div>
      <div class="hero" data-at="0.34">${esc(sp.hero || '')}</div>
      <div class="sub" data-at="0.95">${(sp.post || []).map(esc).join('<br>')}</div></div>`;
  }
  if (st === 'highlight') {
    const lines = (sp.lines || []).map((ln, i) => {
      let html = esc(ln);
      if (sp.hlPhrase && ln.includes(sp.hlPhrase))
        html = esc(ln).split(esc(sp.hlPhrase)).join(`<mark data-at="${(0.15 + i * 0.5 + 0.3).toFixed(2)}">${esc(sp.hlPhrase)}</mark>`);
      return `<div class="kg" data-at="${(0.15 + i * 0.5).toFixed(2)}">${html}</div>`;
    }).join('');
    return `<div id="khook" class="highlight">${lines}</div>`;
  }
  const lines = (sp.lines || []).map((ln, i) =>
    `<div class="kg" data-at="${(0.12 + i * 0.5).toFixed(2)}">${hlWrap(ln, sp.hl)}</div>`).join('');
  return `<div id="khook" class="stack">${lines}</div>`;
}
const khookHtml = buildKhook(HOOK_SPEC);

const badgeScene = scenes.find((s) => s.overlay?.price_badge);
let badgeHtml = '';
if (badgeScene) {
  const p = badgeScene.prod || {};
  const priceK = Math.round((p.price_vnd || 0) / 1000);
  const regK = p.regular_vnd ? Math.round(p.regular_vnd / 1000) : null;
  badgeHtml = `<div class="badge" data-scene="${badgeScene.idx}">
    ${p.price_is_from ? '<span class="from">CHỈ TỪ</span>' : ''}
    <span class="now">${priceK}K</span>
    ${regK ? `<span class="was">${regK}K</span>` : ''}
    ${badgeScene.overlay.label ? `<span class="tag">${badgeScene.overlay.label}</span>` : ''}
  </div>`;
}

const progSegs = scenes.map(() => '<div class="seg"><i></i></div>').join('');

const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<link rel="stylesheet" href="assets/fonts/fonts.css">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:${bg};
    font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  #frame{position:absolute;inset:0}

  /* nền: hai vũng sáng nhẹ để đỡ phẳng */
  #bg{position:absolute;inset:0;background:
    radial-gradient(120% 60% at 50% -8%, #16244a 0%, rgba(11,27,46,0) 55%),
    radial-gradient(90% 50% at 50% 120%, #101a33 0%, rgba(11,27,46,0) 60%),
    ${bg}}

  /* [V2] nền động từ ảnh sản phẩm: mờ + tối + phủ vignette navy */
  #ambient{position:absolute;inset:0;z-index:0}
  #ambient .amb{position:absolute;inset:-8%;opacity:0;background-size:cover;background-position:center;
    filter:blur(46px) saturate(1.2) brightness(.5);will-change:opacity,transform}
  #ambient::after{content:"";position:absolute;inset:0;pointer-events:none;background:
    radial-gradient(115% 75% at 50% 42%, rgba(11,27,46,.22) 0%, rgba(11,27,46,.72) 62%, rgba(8,18,32,.94) 100%)}

  .scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    opacity:0;padding:300px 130px 720px}
  /* [V2] card có viền sáng mảnh + bóng sâu hơn cho nổi khối */
  .card{width:820px;height:820px;border-radius:28px;overflow:hidden;background:#fff;
    box-shadow:0 50px 110px -34px rgba(0,0,0,.8), 0 0 0 1px rgba(255,255,255,.10),
      inset 0 0 0 1px rgba(255,255,255,.28)}
  .card img{width:100%;height:100%;object-fit:cover;display:block;will-change:transform}

  /* thanh tiến trình + thương hiệu */
  #prog{position:absolute;top:70px;left:80px;right:80px;display:flex;gap:12px;z-index:40}
  #prog .seg{flex:1;height:8px;border-radius:8px;background:rgba(255,255,255,.18);overflow:hidden}
  #prog .seg i{display:block;width:0;height:100%;background:${accent};border-radius:8px}
  #brand{position:absolute;top:96px;left:82px;z-index:40;display:flex;align-items:center}
  #brand img{height:96px;width:auto;display:block;filter:drop-shadow(0 4px 12px rgba(0,0,0,.45))}

  /* badge giá — góc trên phải vùng an toàn */
  .badge{position:absolute;top:210px;right:80px;z-index:40;display:none;
    flex-direction:column;align-items:flex-end;gap:4px;
    background:rgba(11,27,46,.72);border:2px solid ${accent};border-radius:20px;
    padding:20px 28px;backdrop-filter:blur(6px)}
  .badge .from{color:${accent};font-size:26px;font-weight:800;letter-spacing:2px}
  .badge .now{color:#fff;font-size:78px;font-weight:800;line-height:.95}
  .badge .was{color:#9FB0C4;font-size:34px;font-weight:600;text-decoration:line-through}
  .badge .tag{margin-top:6px;background:${accent};color:#0B1B2E;font-weight:800;
    font-size:28px;padding:4px 14px;border-radius:8px}

  /* [V2] kinetic hook — chữ to full màn 3 giây đầu */
  #khook{position:absolute;inset:0;z-index:38;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:16px;padding:0 110px;text-align:center;opacity:0}
  #khook::before{content:"";position:absolute;inset:0;z-index:-1;background:
    radial-gradient(85% 62% at 50% 46%, rgba(8,16,30,.42) 0%, rgba(8,16,30,.88) 78%)}
  #khook .kg{font-weight:800;font-size:108px;line-height:1.0;letter-spacing:-1.5px;color:#fff;
    opacity:0;transform:translateY(28px) scale(.9);text-shadow:0 8px 34px rgba(0,0,0,.6);text-wrap:balance}
  #khook .kg .hi{color:${accent}}
  /* highlight bar (bút dạ quang) — canh trái */
  #khook.highlight{align-items:flex-start;text-align:left;padding:0 92px}
  #khook.highlight .kg mark{background:${accent};color:#0B1B2E;padding:0 .1em;border-radius:8px;
    display:inline-block;transform:scaleX(0);transform-origin:left center}
  /* word flash */
  #khook.flash .fl-wrap{font-weight:800;font-size:100px;line-height:1.06;letter-spacing:-1px;color:#fff;
    text-shadow:0 8px 34px rgba(0,0,0,.6);text-wrap:balance}
  #khook.flash .fw{display:inline-block;opacity:0;transform:scale(.6)}
  #khook.flash .fw.hi{color:${accent}}
  /* number slam */
  #khook.slam .sub{font-weight:800;font-size:66px;line-height:1.1;color:#fff;opacity:0;
    transform:translateY(18px);text-shadow:0 6px 26px rgba(0,0,0,.6)}
  #khook.slam .hero{font-weight:800;font-size:280px;line-height:.86;color:${accent};opacity:0;
    letter-spacing:-6px;text-shadow:0 12px 50px rgba(0,0,0,.5);margin:4px 0}
</style></head>
<body>
  <div id="frame">
    <div id="bg"></div>
    <div id="ambient">${ambientLayers}</div>
    ${sceneLayers}
    <div id="prog">${progSegs}</div>
    <div id="brand"><img src="assets/logo.png" alt="Lucas"></div>
    ${badgeHtml}
    ${khookHtml}
  </div>

<script type="module">
${component}

const scenes = ${JSON.stringify(scenes.map((s) => ({ i: s.idx, start: s.start, end: s.end })))};
const FADE = ${FADE};
const TOTAL = ${total};
const frame = document.getElementById('frame');
const sub = mountSubtitles(frame, ${JSON.stringify(cues)}, { accent: '${accent}' });

const layers = [...document.querySelectorAll('.scene')];
const cards = layers.map((l) => l.querySelector('.card'));
const ambs = [...document.querySelectorAll('#ambient .amb')];
const segs = [...document.querySelectorAll('#prog .seg i')];
const badge = document.querySelector('.badge');
const badgeScene = badge ? Number(badge.dataset.scene) : -1;
const badgeNow = badge ? badge.querySelector('.now') : null;
const priceTarget = badgeNow ? (parseInt(badgeNow.textContent, 10) || 0) : 0; // "1700K" -> 1700

// [V2] kinetic hook refs
const KHOOK_END = ${hookEnd};
const khook = document.getElementById('khook');
const kEls = khook ? [...khook.querySelectorAll('[data-at]')] : [];
const khStyle = khook ? khook.className : '';

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const c01 = (x) => Math.max(0, Math.min(1, x));

// [V2] Ken Burns: mỗi cảnh pan + zoom một HƯỚNG khác nhau -> video "thở",
// đỡ cảm giác ảnh dán tĩnh. Crossfade 0.25s che chỗ reset giữa các cảnh.
const KB = [[0,0],[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[1,0],[-1,0]];

window.__render = (t) => {
  scenes.forEach((s, i) => {
    const fadeIn = smooth((t - (s.start - FADE)) / FADE);
    const alive = t >= s.start - FADE && t < s.end;
    layers[i].style.opacity = alive ? fadeIn : 0;

    const e = smooth(c01((t - s.start) / Math.max(0.1, s.end - s.start)));
    const [dx, dy] = KB[i % KB.length];
    const sc = 1.05 + 0.09 * e;                       // 1.05 -> 1.14
    cards[i].style.transform =
      'translate(' + (dx * 26 * (e - .5)).toFixed(1) + 'px,' +
      (dy * 26 * (e - .5)).toFixed(1) + 'px) scale(' + sc.toFixed(4) + ')';

    // [V2] nền động: crossfade theo cảnh + trôi NGƯỢC hướng card -> chiều sâu
    if (ambs[i]) {
      ambs[i].style.opacity = alive ? (0.92 * fadeIn) : 0;
      ambs[i].style.transform = 'scale(' + (1.12 + 0.06 * e).toFixed(3) + ') translate(' +
        (-dx * 16 * e).toFixed(1) + 'px,' + (-dy * 16 * e).toFixed(1) + 'px)';
    }

    segs[i].style.width = (t >= s.end ? 100 : t <= s.start ? 0 : (c01((t - s.start) / Math.max(0.1, s.end - s.start)) * 100)) + '%';
  });

  if (badge) {
    const s = scenes[badgeScene];
    const on = s && t >= s.start - FADE && t < s.end;
    badge.style.display = on ? 'flex' : 'none';
    if (on) {
      // [V2] pop nảy vào + số giá đếm tăng dần trong 0.55s đầu
      const bp = smooth(c01((t - s.start) / 0.55));
      const pop = 0.80 + 0.20 * bp + 0.04 * Math.sin(bp * Math.PI);
      badge.style.transformOrigin = 'top right';
      badge.style.transform = 'scale(' + pop.toFixed(3) + ')';
      if (badgeNow && priceTarget) badgeNow.textContent = Math.round(priceTarget * bp) + 'K';
    }
  }

  // [V2] kinetic hook: hiện 3 giây đầu, từng cụm nảy vào, rồi mờ đi
  if (khook) {
    let ov = 0;
    if (t < KHOOK_END) {
      const fin = smooth(t / 0.28);                               // vào
      const fout = 1 - smooth((t - (KHOOK_END - 0.3)) / 0.3);     // ra trước khi cắt
      ov = Math.max(0, Math.min(fin, fout));
    }
    khook.style.opacity = ov.toFixed(3);
    kEls.forEach((el) => {
      const at = parseFloat(el.dataset.at);
      const p = smooth(c01((t - at) / 0.34));
      if (el.tagName === 'MARK') { el.style.transform = 'scaleX(' + p.toFixed(3) + ')'; return; }
      el.style.opacity = p.toFixed(3);
      if (el.classList.contains('hero')) {
        el.style.transform = 'scale(' + (1.32 - 0.32 * p + 0.05 * Math.sin(p * Math.PI)).toFixed(3) + ')';
      } else if (el.classList.contains('fw')) {
        el.style.transform = 'scale(' + (0.6 + 0.4 * p + 0.07 * Math.sin(p * Math.PI)).toFixed(3) + ')';
      } else if (khStyle.indexOf('highlight') >= 0) {
        el.style.transform = 'translateX(' + (-24 * (1 - p)).toFixed(1) + 'px)';
      } else {
        const sc = 0.9 + 0.1 * p + 0.035 * Math.sin(p * Math.PI);
        el.style.transform = 'translateY(' + (28 * (1 - p)).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
      }
    });
    // ẩn phụ đề đáy khi kinetic hook đang chạy (khỏi trùng câu)
    if (sub.el) sub.el.style.opacity = t < KHOOK_END - 0.1 ? '0' : '1';
  }

  sub.seek(t);
};
window.__ready = true;
</script>
</body></html>`;

const htmlPath = path.join(dir, 'render.html');
fs.writeFileSync(htmlPath, html);

// --- chụp frame -> ffmpeg ---------------------------------------------------
const nFrames = Math.ceil(total * FPS);
console.log(`\nRender ${W}x${H} @ ${FPS}fps · ${total}s · ${nFrames} frame`);

const silent = path.join(dir, 'silent.mp4');
const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-r', String(FPS),
  silent,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction('window.__ready === true');

const writeFrame = (buf) =>
  new Promise((resolve) => {
    if (ff.stdin.write(buf)) resolve();
    else ff.stdin.once('drain', resolve);
  });

const t0 = Date.now();
for (let f = 0; f < nFrames; f++) {
  const t = f / FPS;
  await page.evaluate((tt) => window.__render(tt), t);
  const buf = await page.screenshot({ type: 'png', optimizeForSpeed: true });
  await writeFrame(buf);
  if (f % 60 === 0 || f === nFrames - 1) {
    process.stdout.write(`\r  frame ${f + 1}/${nFrames}`);
  }
}
process.stdout.write('\n');
ff.stdin.end();
await new Promise((res, rej) => { ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg frame exit ' + c)))); });
await browser.close();
console.log(`  frames xong sau ${((Date.now() - t0) / 1000).toFixed(0)}s → ${path.basename(silent)}`);

// --- ghép audio -------------------------------------------------------------
const voice = job.audio?.voice_path && fs.existsSync(job.audio.voice_path) ? job.audio.voice_path : null;
const bgm = fs.existsSync(path.join(root, 'assets', 'bgm.mp4')) ? path.join(root, 'assets', 'bgm.mp4') : null;
const finalMp4 = path.join(dir, 'final.mp4');

if (voice || bgm) {
  const args = ['-y', '-loglevel', 'error', '-i', silent];
  const parts = [];
  let ai = 1;
  if (voice) { args.push('-i', voice); parts.push({ role: 'voice', idx: ai++ }); }
  if (bgm) { args.push('-stream_loop', '-1', '-i', bgm); parts.push({ role: 'bgm', idx: ai++ }); }

  const ducked = voice ? 0.14 : 0.32; // có giọng thì hạ nhạc để nghe rõ lời
  const fl = [];
  const labels = [];
  for (const p of parts) {
    const vol = p.role === 'bgm' ? ducked : 1.0;
    fl.push(`[${p.idx}:a]volume=${vol}[a${p.idx}]`);
    labels.push(`[a${p.idx}]`);
  }
  let audioMap;
  if (labels.length > 1) {
    fl.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[mix]`);
    audioMap = '[mix]';
  } else {
    audioMap = labels[0];
  }
  args.push('-filter_complex', fl.join(';'),
    '-map', '0:v', '-map', audioMap,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
    '-t', String(total), '-movflags', '+faststart', finalMp4);

  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  fs.rmSync(silent, { force: true });
} else {
  fs.renameSync(silent, finalMp4);
}

// --- [V2] SFX: whoosh mỗi lần cắt cảnh + pop khi badge giá bật ---------------
// Tổng hợp bằng ffmpeg (không cần file rời). Muốn tiếng xịn hơn thì thay bằng
// assets/sfx/whoosh.wav + pop.wav. Chỉ chạy khi video đã có audio.
const cutTimes = scenes.slice(1).map((s) => s.start);
if ((voice || bgm) && cutTimes.length) {
  const whoosh = path.join(dir, 'assets', 'whoosh.wav');
  const pop = path.join(dir, 'assets', 'pop.wav');
  const userWhoosh = path.join(root, 'assets', 'sfx', 'whoosh.wav');
  const userPop = path.join(root, 'assets', 'sfx', 'pop.wav');
  if (fs.existsSync(userWhoosh)) fs.copyFileSync(userWhoosh, whoosh);
  else execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=d=0.4:c=pink:r=44100:a=0.55',
    '-af', 'highpass=f=260,lowpass=f=3600,afade=t=in:d=0.16,afade=t=out:st=0.17:d=0.22', whoosh]);
  if (fs.existsSync(userPop)) fs.copyFileSync(userPop, pop);
  else execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=740:duration=0.16:sample_rate=44100',
    '-af', 'afade=t=out:st=0.015:d=0.14:curve=exp', pop]);

  const badgeStart = badgeScene ? badgeScene.start : null;
  const n = cutTimes.length;
  let fc = `[1:a]asplit=${n}` + Array.from({ length: n }, (_, i) => `[w${i}s]`).join('') + ';';
  let labels = '';
  cutTimes.forEach((tt, i) => {
    const ms = Math.max(0, Math.round((tt - 0.08) * 1000)); // vào sớm 80ms cho có đà
    fc += `[w${i}s]adelay=${ms}|${ms},volume=0.26[w${i}];`;
    labels += `[w${i}]`;
  });
  const inputs = ['-y', '-loglevel', 'error', '-i', finalMp4, '-i', whoosh];
  let count = n + 1; // [0:a] + n whoosh
  if (badgeStart != null) {
    inputs.push('-i', pop);
    const pms = Math.round(badgeStart * 1000);
    fc += `[2:a]adelay=${pms}|${pms},volume=0.5[pp];`;
    labels += '[pp]';
    count += 1;
  }
  fc += `[0:a]${labels}amix=inputs=${count}:duration=first:normalize=0,alimiter=limit=0.97[mix]`;
  const sfxOut = path.join(dir, 'final-sfx.mp4');
  execFileSync('ffmpeg', [...inputs, '-filter_complex', fc, '-map', '0:v', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', sfxOut], { stdio: 'inherit' });
  fs.renameSync(sfxOut, finalMp4);
  console.log('  đã trộn SFX (whoosh + pop)');
}

const mb = (fs.statSync(finalMp4).size / 1024 / 1024).toFixed(1);
console.log(`\n\x1b[32m✔\x1b[0m ${finalMp4} (${mb} MB, ${total}s)`);
if (job.audio?.draft) console.log('\x1b[33m▲ Giọng đọc là bản NHÁP (macOS). Thêm ELEVENLABS_API_KEY rồi chạy lại voice→align→render cho bản đăng.\x1b[0m');
