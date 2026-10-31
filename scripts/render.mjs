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
const scenes = job.scenes.map((s, i) => {
  const start = s.start_sec ?? cursor;
  const end = s.end_sec ?? start + s.duration_sec;
  cursor = end;
  const prod = bySku.get(s.sku_ref) || job.products?.[0];
  return { ...s, idx: s.idx ?? i, start, end, prod };
});
const total = Number((job.audio?.measured_duration_sec || scenes.at(-1).end + 0.2).toFixed(3));

// --- tải ảnh sản phẩm -------------------------------------------------------
async function download(urlStr, dest) {
  const res = await fetch(urlStr, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://lucas.vn/',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
      'x-lucas-key': 'lucas-daily-reel-secret',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const server = res.headers.get("server");
    const cfRay = res.headers.get("cf-ray");
    throw new Error(`tải ảnh ${res.status} [server: ${server}, cf-ray: ${cfRay}]: ${urlStr} | body: ${body.slice(0, 200).replace(/\s+/g, " ")}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error(`ảnh nghi hỏng (${buf.length}B): ${urlStr}`);
  fs.writeFileSync(dest, buf);
}

const imgMap = new Map(); // url -> { raw, cut, mode }
const smartCutoutPy = path.join(root, 'scripts', 'smart_cutout.py');
for (const s of scenes) {
  const src = s.asset?.src || s.prod?.image;
  if (!src) throw new Error(`cảnh ${s.idx}: không có ảnh (asset.src hoặc product.image)`);
  if (!imgMap.has(src)) {
    const idx = imgMap.size;
    const name = `assets/img-${idx}.png`;
    const cutName = `assets/img-${idx}-cut.png`;
    const dest = path.join(dir, name);
    const cutDest = path.join(dir, cutName);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 5000) {
      process.stdout.write(`  tải ${src.slice(0, 60)}… `);
      await download(src, dest);
      console.log('ok');
    }
    let mode = 'card';
    if (fs.existsSync(smartCutoutPy)) {
      try {
        const out = execFileSync('python3', [smartCutoutPy, dest, cutDest], { encoding: 'utf8' }).trim();
        const info = JSON.parse(out);
        if (info.mode === 'cutout' && fs.existsSync(cutDest)) {
          mode = 'cutout';
          console.log(`  ✦ img-${idx}: tách nền 3D Studio Cutout (${info.fg_pct}%)`);
        }
      } catch {
        mode = 'card';
      }
    }
    imgMap.set(src, { raw: name, cut: mode === 'cutout' ? cutName : name, mode });
  }
  const entry = imgMap.get(src);
  s._img = entry.raw;
  s._cutImg = entry.cut;
  s._mode = entry.mode;
}

// --- font -------------------------------------------------------------------
fs.cpSync(path.join(root, 'assets', 'fonts'), path.join(dir, 'assets', 'fonts'), { recursive: true });
fs.copyFileSync(path.join(root, 'assets', 'logo.png'), path.join(dir, 'assets', 'logo.png'));


const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function extractSceneSpecs(text, role) {
  if (role === 'hook' || role === 'price' || role === 'cta') return [];
  const specs = [];
  const raw = String(text || '');
  const patterns = [
    /CRI\s*(?:trên|>|≥)?\s*\d+\+?/gi,
    /(?:\d+|hai|ba|bốn|năm)\s+(?:nhiệt\s+độ\s+màu|chế\s+độ\s+sáng|cổng\s+sạc|mức\s+nhiệt)/gi,
    /(?:xoay\s+(?:hơn\s+)?)?\d+(?:\s*(?:tới|đến|-|~)\s*\d+)?\s*(?:%|°|W|mAh|Wh|g|kg|mm|cm|m|inch|Hz|nit|độ|cổng|lần|giờ|tiếng)(?=$|[\s.,;!?)])/gi,
    /\b(?:USB-C|Type-C|MagSafe|Qi2|GaN|PD\s*\d*W?|Bluetooth\s*[\d.]*|IP\d\d|YKK|SGS|360°|180°)(?=$|[\s.,;!?)])/gi,
    /\b(?:chống\s+nước|chống\s+sốc|gắn\s+từ\s+tính|từ\s+tính|nhôm\s+CNC|sợi\s+aramid|bảo\s+hành\s+\d+\s*tháng)\b/gi,
  ];
  for (const re of patterns) {
    for (const m of raw.matchAll(re)) {
      const val = m[0].trim().replace(/[.,;!?]+$/, '');
      if (val && !specs.some((x) => x.toLowerCase() === val.toLowerCase())) specs.push(val);
      if (specs.length >= 3) break;
    }
    if (specs.length >= 3) break;
  }
  return specs;
}

function extractHeroWord(text, idx, mainProd) {
  const raw = String(text || '');
  const mCri = raw.match(/CRI\s*(?:trên|>|≥)?\s*(\d+)/i);
  if (mCri) return { word: `CRI ${mCri[1]}+`, sub: 'CHUẨN MÀU STUDIO CHUYÊN NGHIỆP' };
  const mPct = raw.match(/(\d+\s*%)/);
  if (mPct) return { word: `10–${mPct[1].replace(/\s+/g, '')}`, sub: 'ĐIỀU CHỈNH ĐỘ SÁNG MƯỢT MÀ' };
  const mTemp = raw.match(/(?:\d+|ba|bốn)\s+nhiệt\s+độ\s+màu/i);
  if (mTemp) return { word: '3 TONE MÀU', sub: 'ẤM · TRUNG TÍNH · TRẮNG LẠNH' };
  const mGram = raw.match(/(\d+\s*g)(?=$|[\s.,;!?])/i);
  if (mGram) return { word: `SIÊU NHẸ ${mGram[1].toUpperCase()}`, sub: 'GẮN NAM CHÂM KHÔNG MỎI TAY' };
  const mCode = (mainProd?.name || '').match(/\b([A-Z]{1,4}\d{2,4}[A-Z]?)\b/);
  if (mCode && idx === 0) return { word: mCode[1].toUpperCase(), sub: 'MAGNETIC FILL LIGHT' };
  const fallbacks = [
    { word: 'PRO STUDIO', sub: 'PHỤ KIỆN QUAY CHỤP CHÍNH HÃNG' },
    { word: 'MAGSAFE', sub: 'HÍT TỪ TÍNH SIÊU CHẮC CHẮN' },
    { word: 'LUCAS.VN', sub: 'BẢO HÀNH CHÍNH HÃNG TOÀN QUỐC' },
  ];
  return fallbacks[idx % fallbacks.length];
}

const mainProd = job.products?.[0] || {};
const shortProdName = esc((mainProd.name || 'Phụ kiện chính hãng Lucas').replace(/\s*\([^)]*\)\s*/g, ' ').trim());

// Gán theme cho từng cảnh theo nhịp Katana:
// Cảnh chẵn (0, 1, 3, 5): Dark Graphite/Obsidian
// Cảnh điểm nhấn (2, 4): Warm Editorial Paper (#F4F0E6) để đảo thị giác cực mạnh!
scenes.forEach((s, i) => {
  s._theme = (i === 2 || i === 4) ? 'paper' : 'dark';
});

// Vòng bánh đà 120 vạch + Sao chổi sáng (từ WordRelayGeometry.tsx - FasterGeo)
const fasterTicksSvg = Array.from({ length: 120 }, (_, k) => {
  const a = (k / 120) * Math.PI * 2;
  const long = k % 10 === 0;
  const r0 = 380 - (long ? 22 : 10);
  const r1 = 380;
  return `<line x1="${(r0 * Math.cos(a)).toFixed(1)}" y1="${(r0 * Math.sin(a)).toFixed(1)}" x2="${(r1 * Math.cos(a)).toFixed(1)}" y2="${(r1 * Math.sin(a)).toFixed(1)}" stroke="${long ? 'rgba(201,162,39,0.85)' : 'rgba(236,238,244,0.28)'}" stroke-width="${long ? 2.5 : 1.4}" />`;
}).join('');

const sceneLayers = scenes.map((s) => {
  const focusY = s.asset?.focus === 'top' ? '18%' : s.asset?.focus === 'bottom' ? '82%' : '50%';
  const specs = extractSceneSpecs(s.text, s.role);
  const hero = extractHeroWord(s.text, s.idx, mainProd);
  const isPaper = s._theme === 'paper';
  const geoKind = s.idx % 2 === 1 ? 'faster' : 'tighter';

  // Bento Spec Grid cho thông số
  const bentoHtml = specs.length
    ? `<div class="katana-bento ${isPaper ? 'is-paper' : ''}">
        ${specs.map((sp, ci) => `
          <div class="kb-cell" data-chip="${ci}">
            <div class="kb-val">${esc(sp)}</div>
            <div class="kb-bar"><i class="kb-fill"></i></div>
          </div>
        `).join('')}
      </div>`
    : '';

  // Marquee Kinetic Strip chạy chéo/ngang ở hậu cảnh
  const marqueeText = Array.from({ length: 6 }, () => `${hero.word} ✦ LUCAS COMBO ✦`).join(' ');

  if (s._mode === 'cutout') {
    return `<div class="scene is-cutout theme-${s._theme}" data-i="${s.idx}" data-role="${s.role}" data-mode="cutout" data-theme="${s._theme}" data-geo="${geoKind}" style="z-index:${s.idx + 1}">
      <div class="katana-marquee"><div class="km-track">${esc(marqueeText)}</div></div>
      <div class="card-stage cutout-stage">
        <div class="studio-halo"></div>
        ${geoKind === 'faster' ? `
          <svg class="katana-geo geo-faster" viewBox="-420 -420 840 840">
            <circle class="gf-dash" r="335" fill="none" stroke="${isPaper ? 'rgba(11,27,46,0.35)' : 'rgba(236,238,244,0.38)'}" stroke-width="2.2" stroke-dasharray="12 18" />
            <g class="gf-ticks">${fasterTicksSvg}</g>
            <circle r="275" fill="none" stroke="${isPaper ? 'rgba(201,162,39,0.35)' : 'rgba(201,162,39,0.22)'}" stroke-width="1.5" />
            <circle class="gf-comet" r="335" fill="none" stroke="#C9A227" stroke-width="5" stroke-linecap="round" stroke-dasharray="160 2000" />
          </svg>
        ` : `
          <svg class="katana-geo geo-tighter" viewBox="-420 -420 840 840">
            <circle class="gt-c gt-c0" cx="-140" cy="0" r="195" fill="none" stroke="${isPaper ? 'rgba(11,27,46,0.32)' : 'rgba(255,255,255,0.38)'}" stroke-width="2.4" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" />
            <circle class="gt-c gt-c1" cx="0" cy="0" r="195" fill="none" stroke="#C9A227" stroke-width="2.8" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" />
            <circle class="gt-c gt-c2" cx="140" cy="0" r="195" fill="none" stroke="${isPaper ? 'rgba(11,27,46,0.32)' : 'rgba(255,255,255,0.38)'}" stroke-width="2.4" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" />
            <g class="gt-rivets">
              <rect x="-76" y="-168" width="12" height="12" fill="#C9A227" transform="rotate(45 -70 -162)" />
              <rect x="-76" y="156" width="12" height="12" fill="#C9A227" transform="rotate(45 -70 162)" />
              <rect x="64" y="-168" width="12" height="12" fill="#C9A227" transform="rotate(45 70 -162)" />
              <rect x="64" y="156" width="12" height="12" fill="#C9A227" transform="rotate(45 70 162)" />
            </g>
          </svg>
        `}
        <div class="katana-hero-type">
          <div class="kht-kicker">${esc(hero.sub)}</div>
          <div class="kht-word-wrap">
            <span class="kht-stroke">${esc(hero.word)}</span>
            <span class="kht-fill">${esc(hero.word)}</span>
          </div>
        </div>
        <div class="studio-pedestal"></div>
        <div class="cutout-wrap">
          <img class="cutout-img" src="${s._cutImg}" alt="">
          <div class="cutout-shine-mask" style="-webkit-mask-image:url('${s._cutImg}');mask-image:url('${s._cutImg}')">
            <div class="card-sheen cutout-beam"></div>
          </div>
        </div>
        ${bentoHtml}
      </div>
    </div>`;
  }

  return `<div class="scene is-card theme-${s._theme}" data-i="${s.idx}" data-role="${s.role}" data-mode="card" data-theme="${s._theme}" style="z-index:${s.idx + 1}">
    <div class="katana-marquee"><div class="km-track">${esc(marqueeText)}</div></div>
    <div class="card-stage">
      ${s.overlay?.price_badge ? '' : `<div class="katana-card-header">
        <span class="kch-sub">${esc(hero.sub)}</span>
        <span class="kch-main">${esc(hero.word)}</span>
      </div>`}
      <div class="card-glow"></div>
      <div class="card">
        <img class="card-img" src="${s._img}" style="object-position:50% ${focusY}">
        <div class="card-sheen"></div>
        <div class="card-ring"></div>
      </div>
      ${bentoHtml}
    </div>
  </div>`;
}).join('\n');

const ambientLayers = scenes
  .map((s) => `<div class="amb" data-i="${s.idx}" style="background-image:url(${s._img})"></div>`)
  .join('\n');

// --- Katana Editorial Hook (0 -> 3.5s) ---
const hookEnd = scenes[1] ? scenes[1].start : 3.5;
function autoHookSpec() {
  const words = ((scenes[0] && scenes[0].text) || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  for (let i = 0; i < words.length; i += 3) lines.push(words.slice(i, i + 3).join(' '));
  if (lines.length > 1 && lines[lines.length - 1].split(' ').length === 1)
    lines[lines.length - 2] += ' ' + lines.pop();
  return { style: 'highlight', lines, hl: [] };
}
const HOOK_SPEC = job.hook || autoHookSpec();
function buildKatanaHook(sp) {
  const rawLines = (sp.lines && sp.lines.length) ? sp.lines : autoHookSpec().lines;
  const fallbackPhrase = !sp.hlPhrase && rawLines.length ? rawLines[rawLines.length - 1] : sp.hlPhrase;
  const linesHtml = rawLines.map((ln, i) => {
    const isLast = i === rawLines.length - 1;
    let html = esc(ln);
    if (fallbackPhrase && ln.includes(fallbackPhrase)) {
      html = esc(ln).split(esc(fallbackPhrase)).join(
        `<span class="kh-slash-box"><i class="kh-slash-bg" data-at="${(0.16 + i * 0.28 + 0.14).toFixed(2)}"></i><b>${esc(fallbackPhrase)}</b></span>`
      );
    } else if (isLast) {
      html = `<span class="kh-slash-box"><i class="kh-slash-bg" data-at="${(0.16 + i * 0.28 + 0.14).toFixed(2)}"></i><b>${esc(ln)}</b></span>`;
    }
    return `<div class="kh-line" data-at="${(0.08 + i * 0.28).toFixed(2)}">${html}</div>`;
  }).join('');

  return `<div id="khook">
    <div class="kh-editorial-frame">
      <div class="kh-lines">${linesHtml}</div>
    </div>
  </div>`;
}
const khookHtml = buildKatanaHook(HOOK_SPEC);

// --- Katana Chrome + DigitRoll Price Badge ---
const badgeScene = scenes.find((s) => s.overlay?.price_badge);
let badgeHtml = '';
if (badgeScene) {
  const p = badgeScene.prod || {};
  const priceK = String(Math.round((p.price_vnd || 0) / 1000));
  const regK = p.regular_vnd ? Math.round(p.regular_vnd / 1000) : null;
  const digitsStrip = '01234567890123456789'.split('').map((d) => `<b>${d}</b>`).join('');
  const rollCols = priceK.split('').map((ch, idx) => {
    const target = '0123456789'.indexOf(ch);
    if (target < 0) return `<span class="d-static">${esc(ch)}</span>`;
    return `<span class="d-col" data-target="${target}" data-idx="${idx}"><span class="d-strip">${digitsStrip}</span></span>`;
  }).join('') + '<span class="d-static">K</span>';

  badgeHtml = `<div class="badge" data-scene="${badgeScene.idx}">
    <div class="badge-top">
      <span class="from">${p.price_is_from ? 'CHỈ TỪ' : 'GIÁ TỐT'}</span>
      ${badgeScene.overlay.label ? `<span class="tag">${esc(badgeScene.overlay.label)}</span>` : ''}
    </div>
    <span class="now digit-roll">${rollCols}</span>
    ${regK ? `<span class="was">Giá gốc ${regK}K</span>` : ''}
  </div>`;
}

const ctaSceneIdx = scenes.findIndex((s) => s.role === 'cta');
const ctaStripHtml = `<div id="cta-strip" data-scene="${ctaSceneIdx}">
  <div class="cta-pill"><span>✔</span> Chính hãng 100%</div>
  <div class="cta-pill"><span>🛡️</span> Bảo hành đầy đủ</div>
  <div class="cta-pill gold"><span>🔗</span> Đặt tại lucas.vn</div>
</div>`;

const component = fs.readFileSync(path.join(root, 'templates', 'subtitle.mjs'), 'utf8');
const ROLE_META = {
  hook: { tag: '01 // HOOK', icon: '⚡' },
  body: { tag: '02 // SPECS', icon: '✦' },
  proof: { tag: '03 // HANDS-ON', icon: '✔' },
  price: { tag: '04 // PRICE DROP', icon: '★' },
  cta: { tag: '05 // LUCAS.VN', icon: '🛡️' },
};

const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<link rel="stylesheet" href="assets/fonts/fonts.css">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:${bg};
    font-family:'Inter',-apple-system,'SF Pro Display','Helvetica Neue',sans-serif;-webkit-font-smoothing:antialiased}
  #frame{position:absolute;inset:0;perspective:1400px}

  /* Nền Dark Graphite & Nền Giấy Kem Editorial (Đảo chiều theo cảnh kiểu Katana) */
  #bg{position:absolute;inset:0;background:
    radial-gradient(120% 60% at 50% -8%, #16244a 0%, rgba(11,27,46,0) 55%),
    radial-gradient(90% 50% at 50% 120%, #101a33 0%, rgba(11,27,46,0) 60%),
    #070F1C}
  #paper-bg{position:absolute;inset:0;z-index:2;opacity:0;pointer-events:none;
    background:
      radial-gradient(90% 60% at 50% 38%, #FFFDF9 0%, #F3EFE6 68%, #E6E0D3 100%)}

  /* Khung lưới Swiss Grid 1px đặc trưng của Katana */
  #swiss-grid{position:absolute;inset:56px;z-index:38;pointer-events:none;
    border:1.5px solid rgba(159,176,196,.18)}
  #swiss-grid::before{content:"";position:absolute;left:0;right:0;top:116px;height:1.5px;background:rgba(159,176,196,.16)}
  #swiss-grid::after{content:"";position:absolute;left:0;right:0;bottom:290px;height:1.5px;background:rgba(159,176,196,.16)}
  #frame.is-paper #swiss-grid{border-color:rgba(11,27,46,.16)}
  #frame.is-paper #swiss-grid::before,#frame.is-paper #swiss-grid::after{background:rgba(11,27,46,.14)}

  #ambient{position:absolute;inset:0;z-index:0}
  #ambient .amb{position:absolute;inset:-8%;opacity:0;background-size:cover;background-position:center;
    filter:blur(52px) saturate(1.3) brightness(.42);will-change:opacity,transform}
  #ambient::after{content:"";position:absolute;inset:0;pointer-events:none;background:
    radial-gradient(110% 70% at 50% 42%, rgba(11,27,46,.18) 0%, rgba(11,27,46,.76) 64%, rgba(6,13,24,.96) 100%)}

  /* Header Katana Telemetry */
  #topbar{position:absolute;top:76px;left:82px;right:82px;z-index:42;
    display:flex;align-items:center;justify-content:space-between}
  .brand-pill{display:inline-flex;align-items:center;gap:14px;
    background:rgba(11,27,46,.86);border:1.5px solid rgba(159,176,196,.26);
    padding:8px 22px 8px 10px;border-radius:99px;backdrop-filter:blur(12px);
    box-shadow:0 12px 30px rgba(0,0,0,.35)}
  #frame.is-paper .brand-pill{background:#0B1B2E;border-color:#0B1B2E}
  .brand-logo-wrap{width:48px;height:48px;border-radius:50%;background:#FFFFFF;
    display:flex;align-items:center;justify-content:center;padding:6px}
  .brand-logo-wrap img{width:100%;height:100%;object-fit:contain;display:block}
  .brand-meta{display:flex;flex-direction:column;gap:1px}
  .brand-name{color:#FFFFFF;font-size:23px;font-weight:800;letter-spacing:-.3px;line-height:1.1}
  .brand-sub{color:${accent};font-size:15px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase}

  .role-pill{display:inline-flex;align-items:center;gap:10px;
    font-family:ui-monospace,'SF Mono',Menlo,monospace;
    background:rgba(11,27,46,.86);border:1.5px solid ${accent};
    padding:12px 22px;border-radius:99px;color:#FFFFFF;font-size:20px;font-weight:800;
    letter-spacing:1.5px;backdrop-filter:blur(12px)}
  #frame.is-paper .role-pill{background:#0B1B2E;color:#FFFFFF}
  .role-pill .rp-icon{color:${accent};font-size:20px}

  /* Marquee chữ đại tự chạy ngang ở hậu cảnh */
  .katana-marquee{position:absolute;left:-20%;right:-20%;top:49%;z-index:0;
    transform:translateY(-50%) rotate(-5deg);pointer-events:none;opacity:.08;overflow:hidden}
  .theme-paper .katana-marquee{opacity:.07}
  .km-track{font-size:190px;font-weight:900;letter-spacing:-6px;white-space:nowrap;
    color:#FFFFFF;text-transform:uppercase;will-change:transform}
  .theme-paper .km-track{color:#0B1B2E}

  /* Sân khấu từng cảnh */
  .scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    opacity:0;padding:220px 96px 610px;z-index:5}
  .card-stage{position:relative;z-index:6;width:840px;height:840px;display:flex;align-items:center;justify-content:center;
    will-change:transform}

  /* Chữ đại tự Katana + Hình học WordRelayGeometry sau lưng sản phẩm */
  .katana-geo{position:absolute;width:820px;height:820px;pointer-events:none;z-index:2;overflow:visible}
  .katana-hero-type{position:absolute;top:-54px;left:-90px;right:-90px;z-index:3;
    display:flex;flex-direction:column;align-items:center;text-align:center;pointer-events:none}
  .kht-kicker{font-family:ui-monospace,'SF Mono',monospace;font-size:21px;font-weight:800;
    letter-spacing:4px;color:${accent};margin-bottom:4px;text-transform:uppercase}
  .theme-paper .kht-kicker{color:#955905}
  .kht-word-wrap{position:relative;font-family:'Helvetica Neue','Inter',sans-serif;
    font-size:152px;font-weight:900;letter-spacing:-5px;line-height:.96;white-space:nowrap;
    padding:0 16px}
  .kht-stroke{display:block;color:transparent;-webkit-text-stroke:3px rgba(201,162,39,.72)}
  .theme-paper .kht-stroke{-webkit-text-stroke:3px rgba(11,27,46,.38)}
  .kht-fill{position:absolute;inset:0;padding:0 16px;color:#FFFFFF;
    text-shadow:0 12px 42px rgba(0,0,0,.55)}
  .theme-paper .kht-fill{color:#0B1B2E;text-shadow:none}

  /* Tiêu đề phía trên khung Card (cho ảnh Lifestyle / Infographic) */
  .katana-card-header{position:absolute;top:-84px;left:0;right:0;z-index:20;
    display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none}
  .kch-sub{font-family:ui-monospace,'SF Mono',monospace;font-size:19px;font-weight:800;
    letter-spacing:3.5px;color:${accent}}
  .theme-paper .kch-sub{color:#955905}
  .kch-main{font-size:66px;font-weight:900;letter-spacing:-2.2px;line-height:1.05;color:#FFFFFF}
  .theme-paper .kch-main{color:#0B1B2E}

  /* 3D Card & 3D Cutout */
  .card-glow{position:absolute;inset:-32px;border-radius:52px;
    background:radial-gradient(circle at 50% 50%, rgba(201,162,39,.28) 0%, rgba(201,162,39,0) 70%);
    opacity:.65;pointer-events:none}
  .card{position:relative;width:780px;height:740px;border-radius:34px;overflow:hidden;background:#fff;
    box-shadow:0 50px 110px -28px rgba(0,0,0,.78), 0 0 0 2px rgba(255,255,255,.22);will-change:transform}
  .theme-paper .card{box-shadow:0 45px 95px -24px rgba(11,27,46,.32), 0 0 0 3px #0B1B2E}
  .card img{width:100%;height:100%;object-fit:cover;display:block;will-change:transform}
  .card-sheen{position:absolute;inset:-40%;pointer-events:none;
    background:linear-gradient(115deg, transparent 38%, rgba(255,255,255,.42) 50%, transparent 62%);
    transform:translateX(-120%) rotate(8deg);will-change:transform}
  .card-ring{position:absolute;inset:0;border-radius:34px;pointer-events:none;
    box-shadow:inset 0 0 0 2px rgba(255,255,255,.35)}

  .studio-halo{position:absolute;width:740px;height:740px;border-radius:50%;pointer-events:none;
    background:radial-gradient(circle at 50% 46%, rgba(201,162,39,.32) 0%, rgba(22,36,74,.38) 44%, rgba(11,27,46,0) 72%)}
  .theme-paper .studio-halo{
    background:radial-gradient(circle at 50% 46%, rgba(201,162,39,.28) 0%, rgba(201,162,39,.08) 48%, transparent 72%)}
  .studio-pedestal{position:absolute;bottom:26px;width:540px;height:92px;border-radius:50%;pointer-events:none;
    background:radial-gradient(closest-side, rgba(0,0,0,.78) 0%, rgba(201,162,39,.25) 55%, transparent 100%);
    filter:blur(4px);will-change:transform,opacity}
  .theme-paper .studio-pedestal{
    background:radial-gradient(closest-side, rgba(11,27,46,.36) 0%, rgba(201,162,39,.22) 55%, transparent 100%)}
  .cutout-wrap{position:relative;width:760px;height:710px;display:flex;align-items:center;justify-content:center;
    z-index:5;will-change:transform;margin-top:46px}
  .cutout-img{width:100%;height:100%;object-fit:contain;display:block;
    filter:drop-shadow(0 38px 42px rgba(0,0,0,.75)) drop-shadow(0 0 26px rgba(201,162,39,.22))}
  .theme-paper .cutout-img{
    filter:drop-shadow(0 34px 38px rgba(11,27,46,.38))}
  .cutout-shine-mask{position:absolute;inset:0;pointer-events:none;z-index:6;
    -webkit-mask-size:contain;mask-size:contain;
    -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
    -webkit-mask-position:center;mask-position:center}
  .cutout-beam{background:linear-gradient(115deg, transparent 34%, rgba(255,255,255,.82) 50%, transparent 66%)}

  /* Katana Bento Telemetry Grid (thay cho pill tròn truyền thống) */
  .katana-bento{position:absolute;left:-24px;right:-24px;bottom:-58px;z-index:26;
    display:flex;justify-content:center;gap:14px;pointer-events:none}
  .kb-cell{flex:1;max-width:290px;background:rgba(8,19,34,.94);
    border:2px solid rgba(201,162,39,.65);border-radius:20px;padding:14px 22px 16px;
    box-shadow:0 20px 44px rgba(0,0,0,.65);backdrop-filter:blur(14px);
    opacity:0;transform:translateY(28px) scale(.88);will-change:transform,opacity}
  .katana-bento.is-paper .kb-cell{background:#0B1B2E;border-color:#0B1B2E;
    box-shadow:0 18px 36px rgba(11,27,46,.28)}
  .kb-idx{font-family:ui-monospace,'SF Mono',monospace;font-size:15px;font-weight:800;
    letter-spacing:2px;color:${accent};margin-bottom:4px}
  .kb-val{color:#FFFFFF;font-size:31px;font-weight:900;letter-spacing:-.6px;line-height:1.1;white-space:nowrap}
  .kb-bar{margin-top:10px;height:4px;border-radius:99px;background:rgba(255,255,255,.16);overflow:hidden}
  .kb-fill{display:block;height:100%;width:0%;background:${accent};border-radius:99px}

  /* Badge giá DigitRoll */
  .badge{position:absolute;top:174px;right:82px;z-index:44;display:none;
    flex-direction:column;align-items:flex-end;gap:6px;
    background:rgba(8,19,34,.95);border:3px solid ${accent};border-radius:26px;
    padding:20px 32px;backdrop-filter:blur(16px);
    box-shadow:0 28px 65px rgba(0,0,0,.78), 0 0 36px rgba(201,162,39,.38)}
  .badge-top{display:flex;align-items:center;gap:12px}
  .badge .from{color:${accent};font-size:24px;font-weight:800;letter-spacing:2px}
  .badge .tag{background:${accent};color:#0B1B2E;font-weight:900;
    font-size:22px;padding:4px 14px;border-radius:10px;letter-spacing:.5px}
  .badge .now{color:#FFFFFF;font-size:88px;font-weight:900;line-height:1;letter-spacing:-2px;
    text-shadow:0 6px 24px rgba(201,162,39,.4)}
  .badge .digit-roll{display:inline-flex;align-items:baseline;height:88px;overflow:hidden}
  .badge .d-col{display:inline-block;height:88px;overflow:hidden}
  .badge .d-strip{display:block;will-change:transform}
  .badge .d-strip b{display:block;height:88px;line-height:88px;font-weight:900;font-variant-numeric:tabular-nums}
  .badge .d-static{display:inline-block;height:88px;line-height:88px}
  .badge .was{color:#9FB0C4;font-size:30px;font-weight:700;text-decoration:line-through}

  /* CTA Strip */
  #cta-strip{position:absolute;left:72px;right:72px;bottom:640px;z-index:43;
    display:none;justify-content:center;gap:14px;flex-wrap:wrap;pointer-events:none}
  .cta-pill{display:inline-flex;align-items:center;gap:10px;
    background:rgba(11,27,46,.92);border:1.5px solid rgba(159,176,196,.3);
    padding:14px 24px;border-radius:99px;color:#FFFFFF;font-size:27px;font-weight:800;
    box-shadow:0 16px 38px rgba(0,0,0,.55);opacity:0;transform:translateY(20px) scale(.9)}
  .cta-pill.gold{background:${accent};color:#0B1B2E;border-color:${accent};
    box-shadow:0 16px 38px rgba(201,162,39,.45)}

  /* [KATANA EDITORIAL HOOK 3.5s ĐẦU] */
  #khook{position:absolute;inset:0;z-index:41;display:flex;flex-direction:column;
    align-items:center;justify-content:center;padding:80px 84px 200px;opacity:0}
  #khook::before{content:"";position:absolute;inset:0;z-index:-1;background:
    radial-gradient(90% 65% at 50% 45%, rgba(11,27,46,.76) 0%, rgba(6,13,24,.95) 82%)}
  .kh-editorial-frame{width:100%;display:flex;flex-direction:column;gap:24px;
    background:rgba(11,27,46,.88);border:2px solid rgba(201,162,39,.55);
    border-radius:32px;padding:42px 46px 46px;backdrop-filter:blur(20px);
    box-shadow:0 40px 95px rgba(0,0,0,.82)}
  .kh-top-rule,.kh-bot-rule{display:flex;justify-content:space-between;align-items:center;
    font-family:ui-monospace,'SF Mono',monospace;font-size:19px;font-weight:700;
    letter-spacing:2.5px;color:#9FB0C4;padding-bottom:16px;
    border-bottom:1.5px solid rgba(159,176,196,.24);opacity:0}
  .kh-bot-rule{padding-bottom:0;padding-top:18px;border-bottom:none;border-top:1.5px solid rgba(159,176,196,.24);color:${accent}}
  .kh-kicker{display:inline-flex;align-items:center;gap:12px;align-self:flex-start;
    background:rgba(201,162,39,.18);border:1.5px solid ${accent};
    padding:8px 22px;border-radius:99px;color:${accent};font-size:21px;font-weight:800;
    letter-spacing:2px;opacity:0}
  .kh-dot{width:11px;height:11px;border-radius:50%;background:${accent};box-shadow:0 0 10px ${accent}}
  .kh-lines{display:flex;flex-direction:column;gap:14px;text-align:left}
  .kh-line{font-weight:900;font-size:84px;line-height:1.08;letter-spacing:-2.2px;color:#FFFFFF;
    opacity:0;will-change:transform,opacity,filter}
  .kh-slash-box{position:relative;display:inline-block;padding:2px 18px 6px;color:#0B1B2E;z-index:1}
  .kh-slash-box b{position:relative;z-index:2;font-weight:900}
  .kh-slash-bg{position:absolute;inset:0;z-index:1;background:${accent};border-radius:14px;
    transform:scaleX(0) skewX(-8deg);transform-origin:left center;
    box-shadow:0 12px 34px rgba(201,162,39,.5)}

  /* FlashCut (video-shotcraft/FlashCut.tsx) — Chớp sáng ấm 6 frame ngay điểm cắt cảnh */
  #cut-flash{position:absolute;inset:0;z-index:48;pointer-events:none;
    background:radial-gradient(circle at 50% 48%, #FFFDF8 0%, rgba(255,224,125,.65) 55%, rgba(201,162,39,0) 100%);
    opacity:0}

  /* Đảo màu phụ đề khi ở cảnh Giấy Kem Editorial (Paper Theme) */
  #frame.is-paper .lcs-cue-card::before{
    inset:-4px -18px;
    background:rgba(11,27,46,.95);
    border:2px solid #C9A227;
    border-radius:26px;
    box-shadow:0 22px 48px rgba(11,27,46,.28)}
</style></head>
<body>
  <div id="frame">
    <div id="bg"></div>
    <div id="paper-bg"></div>
    <div id="ambient">${ambientLayers}</div>
    <div id="swiss-grid"></div>
    ${sceneLayers}
    <div id="cut-flash"></div>
    <div id="topbar">
      <div class="brand-pill">
        <div class="brand-logo-wrap"><img src="assets/logo.png" alt="Lucas"></div>
        <div class="brand-meta">
          <span class="brand-name">Lucas Combo</span>
          <span class="brand-sub">Chính Hãng · lucas.vn</span>
        </div>
      </div>
    </div>
    ${badgeHtml}
    ${ctaStripHtml}
    ${khookHtml}
  </div>

<script type="module">
${component}

const scenes = ${JSON.stringify(scenes.map((s) => ({ i: s.idx, role: s.role, start: s.start, end: s.end, theme: s._theme, geo: s._mode === 'cutout' ? (s.idx % 2 === 1 ? 'faster' : 'tighter') : 'none' })))};
const ROLE_META = ${JSON.stringify(ROLE_META)};
const FADE = ${FADE};
const TOTAL = ${total};
const frame = document.getElementById('frame');
const paperBg = document.getElementById('paper-bg');
const sub = mountSubtitles(frame, ${JSON.stringify(cues)}, { accent: '${accent}' });

const layers = [...document.querySelectorAll('.scene')];
const stages = layers.map((l) => l.querySelector('.card-stage'));
const imgs = layers.map((l) => l.querySelector('.card-img'));
const cutoutWraps = layers.map((l) => l.querySelector('.cutout-wrap'));
const pedestals = layers.map((l) => l.querySelector('.studio-pedestal'));
const sheens = layers.map((l) => l.querySelector('.card-sheen'));
const kmTracks = layers.map((l) => l.querySelector('.km-track'));
const khtFills = layers.map((l) => l.querySelector('.kht-fill'));
const khtWraps = layers.map((l) => l.querySelector('.kht-word-wrap'));
const gfDashes = layers.map((l) => l.querySelector('.gf-dash'));
const gfTicks = layers.map((l) => l.querySelector('.gf-ticks'));
const gfComets = layers.map((l) => l.querySelector('.gf-comet'));
const gtCircles = layers.map((l) => [...l.querySelectorAll('.gt-c')]);
const gtRivets = layers.map((l) => l.querySelector('.gt-rivets'));
const bentoGroups = layers.map((l) => [...l.querySelectorAll('.kb-cell')]);
const ambs = [...document.querySelectorAll('#ambient .amb')];
const badge = document.querySelector('.badge');
const badgeScene = badge ? Number(badge.dataset.scene) : -1;
const digitCols = badge ? [...badge.querySelectorAll('.d-col')] : [];
const ctaStrip = document.getElementById('cta-strip');
const ctaPills = ctaStrip ? [...ctaStrip.querySelectorAll('.cta-pill')] : [];
const rpIcon = document.getElementById('rp-icon');
const rpText = document.getElementById('rp-text');
const cutFlash = document.getElementById('cut-flash');

const KHOOK_END = ${hookEnd};
const khook = document.getElementById('khook');
const kEls = khook ? [...khook.querySelectorAll('[data-at]')] : [];

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const snappy = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3.6));
const c01 = (x) => Math.max(0, Math.min(1, x));

const KB = [[0,0],[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[1,0],[-1,0]];
const TILT = [
  [0, 0],
  [-2.2, 2.8],
  [2.0, -2.6],
  [-1.8, -2.4],
  [2.4, 2.0],
  [0, 2.5],
  [0, 0],
];

window.__render = (t) => {
  const curScene = scenes.find((s) => t >= s.start && t < s.end) || scenes[0];

  // Đảo nền Paper Editorial (#F4F0E6) theo cảnh kiểu Katana
  const isPaperNow = curScene && curScene.theme === 'paper' && t >= KHOOK_END;
  frame.classList.toggle('is-paper', Boolean(isPaperNow));
  if (paperBg) {
    let paperOp = 0;
    scenes.forEach((s) => {
      if (s.theme === 'paper') {
        const fi = smooth((t - (s.start - 0.14)) / 0.18);
        const fo = 1 - smooth((t - (s.end - 0.14)) / 0.18);
        if (t >= s.start - 0.16 && t <= s.end + 0.16) {
          paperOp = Math.max(paperOp, Math.min(fi, fo));
        }
      }
    });
    paperBg.style.opacity = paperOp.toFixed(3);
  }

  // FlashCut ấm ở điểm chuyển cảnh
  let flashOp = 0;
  for (let i = 1; i < scenes.length; i++) {
    const dt = t - scenes[i].start;
    if (dt >= -0.05 && dt <= 0.15) {
      const fp = 1 - Math.abs(dt - 0.03) / 0.11;
      const weight = (scenes[i].theme !== scenes[i - 1].theme || scenes[i].role === 'price') ? 0.72 : 0.34;
      flashOp = Math.max(flashOp, Math.max(0, fp) * weight);
    }
  }
  if (cutFlash) cutFlash.style.opacity = flashOp.toFixed(3);

  scenes.forEach((s, i) => {
    const fadeIn = smooth((t - (s.start - FADE)) / FADE);
    const alive = t >= s.start - FADE && t < s.end;
    layers[i].style.opacity = alive ? fadeIn : 0;

    const dur = Math.max(0.1, s.end - s.start);
    const localT = t - s.start;
    const e = smooth(c01(localT / dur));
    const [dx, dy] = KB[i % KB.length];
    const [rx, ry] = TILT[i % TILT.length];

    // Marquee chữ khổng lồ trôi ngang ở hậu cảnh
    if (kmTracks[i]) {
      const mx = (i % 2 === 0 ? -1 : 1) * localT * 140;
      kmTracks[i].style.transform = 'translateX(' + mx.toFixed(1) + 'px)';
    }

    // Chuyển cảnh Camera Crash-Zoom / Whip-Slide kiểu Katana
    const enterP = snappy(c01((localT + 0.05) / 0.30));
    const punchBounce = Math.sin(enterP * Math.PI);
    const enterY = (i % 2 === 1 ? 1 : -1) * (1 - enterP) * 48;
    const stageScale = (0.88 + 0.12 * enterP) + 0.035 * punchBounce;
    const curRx = rx * (0.4 + 0.6 * e);
    const curRy = ry * (e - 0.5) * 1.8;

    stages[i].style.transform =
      'translateY(' + enterY.toFixed(1) + 'px) scale(' + stageScale.toFixed(3) + ') rotateX(' + curRx.toFixed(2) + 'deg) rotateY(' + curRy.toFixed(2) + 'deg)';

    const imgScale = 1.02 + 0.08 * e;
    if (imgs[i]) {
      imgs[i].style.transform =
        'translate(' + (dx * 22 * (e - 0.5)).toFixed(1) + 'px, ' + (dy * 22 * (e - 0.5)).toFixed(1) + 'px) scale(' + imgScale.toFixed(4) + ')';
    }

    // 3D Cutout + WordRelayGeometry (FasterGeo & TighterGeo)
    if (cutoutWraps[i]) {
      const popP = snappy(c01((localT + 0.04) / 0.38));
      const popOvershoot = Math.sin(popP * Math.PI);
      const floatWave = Math.sin(localT * 2.8);
      const levY = (1 - popP) * 90 + floatWave * 12;
      const cutScale = (0.76 + 0.24 * popP + 0.06 * popOvershoot) * (1 + 0.04 * e);
      const cutRot = (dx || 1) * floatWave * 1.6;
      cutoutWraps[i].style.transform =
        'translateY(' + levY.toFixed(1) + 'px) scale(' + cutScale.toFixed(3) + ') rotateZ(' + cutRot.toFixed(2) + 'deg)';

      if (pedestals[i]) {
        const pedScale = (0.65 + 0.35 * popP) * (1 - floatWave * 0.09);
        pedestals[i].style.transform = 'scale(' + pedScale.toFixed(3) + ')';
      }

      // Chữ đại tự Katana (kht-word-wrap): thu nhỏ snappy 1.45 -> 1.0 + quét Mask ngang (WordRelayGeometry.tsx)
      if (khtWraps[i]) {
        const wIn = snappy(c01(localT / 0.36));
        const wScale = 1.42 - 0.42 * wIn;
        khtWraps[i].style.transform = 'scale(' + wScale.toFixed(3) + ')';
      }
      if (khtFills[i]) {
        const fillP = snappy(c01((localT - 0.24) / 0.52));
        const edge = fillP * 116 - 8;
        const mask = 'linear-gradient(90deg, #000 ' + (edge - 8).toFixed(1) + '%, transparent ' + (edge + 8).toFixed(1) + '%)';
        khtFills[i].style.webkitMaskImage = mask;
        khtFills[i].style.maskImage = mask;
      }

      // Hình học 1: FasterGeo (Bánh đà 120 vạch + Sao chổi)
      if (gfDashes[i]) {
        const grow = snappy(c01(localT / 0.65));
        const spin = -90 - 150 * (1 - grow) + localT * 28;
        const spinTicks = 40 * (1 - grow) - localT * 12;
        const cometRot = -90 + localT * 210 - 180 * (1 - grow);
        gfDashes[i].setAttribute('transform', 'rotate(' + spin.toFixed(1) + ')');
        if (gfTicks[i]) gfTicks[i].setAttribute('transform', 'rotate(' + spinTicks.toFixed(1) + ')');
        if (gfComets[i]) gfComets[i].setAttribute('transform', 'rotate(' + cometRot.toFixed(1) + ')');
      }

      // Hình học 2: TighterGeo (3 vòng tròn vẽ nét rồi khóa chặt 4 đinh tán kim cương)
      if (gtCircles[i] && gtCircles[i].length) {
        const tightP = snappy(c01((localT - 0.65) / 0.42));
        const gap = 165 - 35 * tightP;
        gtCircles[i].forEach((cEl, ci) => {
          const grow = snappy(c01((localT - ci * 0.14) / 0.58));
          cEl.setAttribute('stroke-dashoffset', (1 - grow).toFixed(3));
          cEl.setAttribute('cx', String((ci - 1) * gap));
        });
        if (gtRivets[i]) {
          const rvP = snappy(c01((localT - 0.82) / 0.28));
          gtRivets[i].style.opacity = rvP.toFixed(3);
        }
      }
    }

    if (sheens[i]) {
      const sheenCycle = (localT - 0.1) % 2.4;
      const sheenP = c01(sheenCycle / 0.78);
      const sheenX = -120 + 260 * smooth(sheenP);
      sheens[i].style.transform = 'translateX(' + sheenX.toFixed(1) + '%) rotate(12deg)';
    }

    // Bento Telemetry Spec Cells + Thanh đo năng lượng
    if (bentoGroups[i] && bentoGroups[i].length) {
      bentoGroups[i].forEach((cell, ci) => {
        const cStart = 0.16 + ci * 0.18;
        const cp = snappy(c01((localT - cStart) / 0.32));
        const cb = Math.sin(cp * Math.PI);
        cell.style.opacity = cp.toFixed(3);
        cell.style.transform = 'translateY(' + ((1 - cp) * 28).toFixed(1) + 'px) scale(' + (0.86 + 0.14 * cp + 0.04 * cb).toFixed(3) + ')';
        const barFill = cell.querySelector('.kb-fill');
        if (barFill) {
          const bp = snappy(c01((localT - (cStart + 0.12)) / 0.48));
          barFill.style.width = (bp * 100).toFixed(1) + '%';
        }
      });
    }

    if (ambs[i]) {
      ambs[i].style.opacity = alive && !isPaperNow ? (0.92 * fadeIn) : 0;
      ambs[i].style.transform = 'scale(' + (1.12 + 0.06 * e).toFixed(3) + ') translate(' +
        (-dx * 16 * e).toFixed(1) + 'px,' + (-dy * 16 * e).toFixed(1) + 'px)';
    }
  });

  if (badge) {
    const s = scenes[badgeScene];
    const on = s && t >= s.start - FADE && t < s.end;
    badge.style.display = on ? 'flex' : 'none';
    if (on) {
      const bp = smooth(c01((t - s.start) / 0.52));
      const pop = 0.78 + 0.22 * bp + 0.06 * Math.sin(bp * Math.PI);
      const pulse = 1 + 0.018 * Math.sin(Math.max(0, t - s.start - 0.52) * 6);
      badge.style.transformOrigin = 'top right';
      badge.style.transform = 'scale(' + (pop * pulse).toFixed(3) + ')';
      digitCols.forEach((col, ci) => {
        const target = Number(col.dataset.target) || 0;
        const dt = c01((t - s.start - ci * 0.11) / 0.68);
        const rollEase = 1 - Math.pow(1 - dt, 3);
        const offsetPx = (10 + target) * rollEase * 88;
        const strip = col.firstElementChild;
        if (strip) strip.style.transform = 'translateY(-' + offsetPx.toFixed(1) + 'px)';
      });
    }
  }

  const ctaSceneIdx = ${ctaSceneIdx};
  if (ctaStrip && ctaSceneIdx >= 0) {
    const cs = scenes[ctaSceneIdx];
    const on = cs && t >= cs.start - 0.1 && t <= cs.end + 0.3;
    ctaStrip.style.display = on ? 'flex' : 'none';
    if (on) {
      ctaPills.forEach((pill, pi) => {
        const pp = smooth(c01((t - cs.start - pi * 0.16) / 0.26));
        const pb = Math.sin(pp * Math.PI);
        pill.style.opacity = pp.toFixed(3);
        pill.style.transform = 'translateY(' + ((1 - pp) * 18).toFixed(1) + 'px) scale(' + (0.88 + 0.12 * pp + 0.05 * pb).toFixed(3) + ')';
      });
    }
  }

  // Katana Editorial Hook 3.5s đầu
  if (khook) {
    let ov = 0;
    if (t < KHOOK_END) {
      const fin = smooth(t / 0.22);
      const fout = 1 - smooth((t - (KHOOK_END - 0.26)) / 0.26);
      ov = Math.max(0, Math.min(fin, fout));
    }
    khook.style.opacity = ov.toFixed(3);
    kEls.forEach((el) => {
      const at = parseFloat(el.dataset.at);
      const p = snappy(c01((t - at) / 0.34));
      if (el.classList.contains('kh-slash-bg')) {
        el.style.transform = 'scaleX(' + p.toFixed(3) + ') skewX(-8deg)';
        return;
      }
      el.style.opacity = p.toFixed(3);
      const blurPx = (1 - p) * 12;
      el.style.filter = blurPx > 0.2 ? 'blur(' + blurPx.toFixed(1) + 'px)' : 'none';
      el.style.transform = 'translateY(' + ((1 - p) * 32).toFixed(1) + 'px)';
    });
    if (sub.el) sub.el.style.opacity = t < KHOOK_END - 0.08 ? '0' : '1';
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
const rawVoice = job.audio?.voice_path;
const resolvedVoice = rawVoice
  ? (fs.existsSync(rawVoice) ? rawVoice : path.join(root, rawVoice))
  : path.join(dir, 'voice.mp3');
const voice = fs.existsSync(resolvedVoice) ? resolvedVoice : null;
const bgm = job.audio?.bgm !== 'none' && fs.existsSync(path.join(root, 'assets', 'bgm.mp4'))
  ? path.join(root, 'assets', 'bgm.mp4')
  : null;
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

// --- [V2] SFX: whoosh-thud mỗi lần cắt cảnh + chime pop khi badge giá bật ---
const cutTimes = scenes.slice(1).map((s) => s.start);
if ((voice || bgm) && cutTimes.length) {
  const whoosh = path.join(dir, 'assets', 'whoosh.wav');
  const pop = path.join(dir, 'assets', 'pop.wav');
  const userWhoosh = path.join(root, 'assets', 'sfx', 'whoosh.wav');
  const userPop = path.join(root, 'assets', 'sfx', 'pop.wav');
  if (fs.existsSync(userWhoosh)) fs.copyFileSync(userWhoosh, whoosh);
  else execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'anoisesrc=d=0.34:c=brown:r=44100:a=0.6',
    '-f', 'lavfi', '-i', 'sine=frequency=95:duration=0.22:sample_rate=44100',
    '-filter_complex',
    '[0:a]highpass=f=140,lowpass=f=2200,afade=t=in:d=0.09,afade=t=out:st=0.11:d=0.22[air];' +
    '[1:a]afade=t=out:st=0.01:d=0.20:curve=exp,volume=0.55[sub];' +
    '[air][sub]amix=inputs=2:normalize=0',
    whoosh,
  ]);
  if (fs.existsSync(userPop)) fs.copyFileSync(userPop, pop);
  else execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.24:sample_rate=44100',
    '-f', 'lavfi', '-i', 'sine=frequency=1318.5:duration=0.28:sample_rate=44100',
    '-filter_complex',
    '[0:a]afade=t=out:st=0.01:d=0.22:curve=exp,volume=0.45[s1];' +
    '[1:a]adelay=28|28,afade=t=out:st=0.02:d=0.24:curve=exp,volume=0.40[s2];' +
    '[s1][s2]amix=inputs=2:normalize=0',
    pop,
  ]);

  const badgeStart = badgeScene ? badgeScene.start : null;
  const n = cutTimes.length;
  let fc = `[1:a]asplit=${n}` + Array.from({ length: n }, (_, i) => `[w${i}s]`).join('') + ';';
  let labels = '';
  cutTimes.forEach((tt, i) => {
    const ms = Math.max(0, Math.round((tt - 0.06) * 1000));
    fc += `[w${i}s]adelay=${ms}|${ms},volume=0.28[w${i}];`;
    labels += `[w${i}]`;
  });
  const inputs = ['-y', '-loglevel', 'error', '-i', finalMp4, '-i', whoosh];
  let count = n + 1;
  if (badgeStart != null) {
    inputs.push('-i', pop);
    const pms = Math.round(badgeStart * 1000);
    fc += `[2:a]adelay=${pms}|${pms},volume=0.55[pp];`;
    labels += '[pp]';
    count += 1;
  }
  fc += `[0:a]${labels}amix=inputs=${count}:duration=first:normalize=0,alimiter=limit=0.97[mix]`;
  const sfxOut = path.join(dir, 'final-sfx.mp4');
  execFileSync('ffmpeg', [...inputs, '-filter_complex', fc, '-map', '0:v', '-map', '[mix]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', sfxOut], { stdio: 'inherit' });
  fs.renameSync(sfxOut, finalMp4);
  console.log('  đã trộn SFX (whoosh-thud + chime-pop)');
}

const mb = (fs.statSync(finalMp4).size / 1024 / 1024).toFixed(1);
console.log(`\n\x1b[32m✔\x1b[0m ${finalMp4} (${mb} MB, ${total}s)`);
if (job.audio?.draft) console.log('\x1b[33m▲ Giọng đọc là bản NHÁP (macOS). Thêm ELEVENLABS_API_KEY rồi chạy lại voice→align→render cho bản đăng.\x1b[0m');
