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

// --- dựng HTML --------------------------------------------------------------
const component = fs.readFileSync(path.join(root, 'templates', 'subtitle.mjs'), 'utf8');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Tự động rút các thông số / điểm mạnh ngắn gọn từ câu thoại của từng cảnh để làm Floating Spec Pills
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
      if (val && !specs.some((x) => x.toLowerCase() === val.toLowerCase())) {
        specs.push(val);
      }
      if (specs.length >= 3) break;
    }
    if (specs.length >= 3) break;
  }
  return specs;
}

const ROLE_META = {
  hook: { tag: 'GÓC HỎI ĐÁP', icon: '⚡' },
  body: { tag: 'ĐIỂM ĂN TIỀN', icon: '✦' },
  proof: { tag: 'TRẢI NGHIỆM THẬT', icon: '✔' },
  price: { tag: 'GIÁ TỐT TẠI LUCAS', icon: '★' },
  cta: { tag: 'CHÍNH HÃNG 100%', icon: '🛡️' },
};

const mainProd = job.products?.[0] || {};
const shortProdName = esc((mainProd.name || 'Phụ kiện chính hãng Lucas').replace(/\s*\([^)]*\)\s*/g, ' ').trim());

// Rút từ khoá đại tự (Hero Depth Word) từ câu thoại để đặt chìm 3D sau lưng sản phẩm tách nền (theo OutlineWordFill.tsx)
function extractHeroWord(text, idx) {
  const raw = String(text || '');
  const mCri = raw.match(/CRI\s*(?:trên|>|≥)?\s*(\d+)/i);
  if (mCri) return `CRI ${mCri[1]}+`;
  const mPct = raw.match(/(\d+\s*%)/);
  if (mPct) return `SÁNG ${mPct[1].replace(/\s+/g, '')}`;
  const mTemp = raw.match(/(?:\d+|ba|bốn)\s+nhiệt\s+độ\s+màu/i);
  if (mTemp) return '3 MÀU SÁNG';
  const mCode = (mainProd.name || '').match(/\b([A-Z]{1,4}\d{2,4}[A-Z]?)\b/);
  if (mCode && idx === 0) return mCode[1].toUpperCase();
  const fallbacks = ['STUDIO 3D', 'PRO LIGHT', 'MAGSAFE', 'CHÍNH HÃNG'];
  return fallbacks[idx % fallbacks.length];
}

// Vòng thước ngắm kỹ thuật 72 vạch (từ video-shotcraft/OutlineWordFill.tsx)
const dialTicksSvg = Array.from({ length: 72 }, (_, i) => {
  const major = i % 6 === 0;
  return `<line x1="0" y1="-326" x2="0" y2="-${major ? 302 : 315}" stroke="#C9A227" stroke-width="${major ? 2.4 : 1.3}" opacity="${major ? 0.72 : 0.32}" transform="rotate(${i * 5})" />`;
}).join('');

const sceneLayers = scenes
  .map((s) => {
    const focusY = s.asset?.focus === 'top' ? '18%' : s.asset?.focus === 'bottom' ? '82%' : '50%';
    const specs = extractSceneSpecs(s.text, s.role);
    const chipsHtml = specs.length
      ? `<div class="spec-chips">${specs
          .map(
            (sp, ci) =>
              `<div class="spec-chip" data-chip="${ci}"><span class="sc-dot"></span><span>${esc(sp)}</span></div>`
          )
          .join('')}</div>`
      : '';
    if (s._mode === 'cutout') {
      const heroWord = esc(extractHeroWord(s.text, s.idx));
      return `<div class="scene is-cutout" data-i="${s.idx}" data-role="${s.role}" data-mode="cutout" style="z-index:${s.idx + 1}">
        <div class="card-stage cutout-stage">
          <div class="studio-halo"></div>
          <svg class="shotcraft-dial" viewBox="-400 -400 800 800">
            <g class="dial-outer">
              <circle r="360" fill="none" stroke="rgba(201,162,39,0.45)" stroke-width="2" stroke-dasharray="22 18" />
              <line x1="0" y1="-380" x2="0" y2="-346" stroke="#C9A227" stroke-width="3" stroke-linecap="round" />
              <line x1="0" y1="346" x2="0" y2="380" stroke="#C9A227" stroke-width="3" stroke-linecap="round" />
              <line x1="-380" y1="0" x2="-346" y2="0" stroke="#C9A227" stroke-width="3" stroke-linecap="round" />
              <line x1="346" y1="0" x2="380" y2="0" stroke="#C9A227" stroke-width="3" stroke-linecap="round" />
            </g>
            <g class="dial-inner">
              <circle r="326" fill="none" stroke="rgba(201,162,39,0.28)" stroke-width="1.2" />
              ${dialTicksSvg}
            </g>
          </svg>
          <div class="depth-hero">
            <span class="dh-outline">${heroWord}</span>
            <span class="dh-solid">${heroWord}</span>
          </div>
          <div class="studio-orbit"></div>
          <div class="studio-pedestal"></div>
          <div class="cutout-wrap">
            <img class="cutout-img" src="${s._cutImg}" alt="">
            <div class="cutout-shine-mask" style="-webkit-mask-image:url('${s._cutImg}');mask-image:url('${s._cutImg}')">
              <div class="card-sheen cutout-beam"></div>
            </div>
          </div>
          ${chipsHtml}
        </div>
      </div>`;
    }
    return `<div class="scene is-card" data-i="${s.idx}" data-role="${s.role}" data-mode="card" style="z-index:${s.idx + 1}">
      <div class="card-stage">
        <div class="card-glow"></div>
        <div class="card">
          <img class="card-img" src="${s._img}" style="object-position:50% ${focusY}">
          <div class="card-sheen"></div>
          <div class="card-ring"></div>
        </div>
        ${chipsHtml}
      </div>
    </div>`;
  })
  .join('\n');

// [V2] Nền động: chính ảnh sản phẩm phóng to + làm mờ + tối, đổi theo từng cảnh.
const ambientLayers = scenes
  .map((s) => `<div class="amb" data-i="${s.idx}" style="background-image:url(${s._img})"></div>`)
  .join('\n');

// [V2] Kinetic hook — BỘ PRESET chọn qua env HOOK_SPEC (JSON): stack | flash | slam | highlight.
const hookEnd = scenes[1] ? scenes[1].start : 3.5;
const hlWrap = (text, hls) => {
  let o = esc(text);
  (hls || []).forEach((h) => { o = o.split(esc(h)).join('<span class="hi">' + esc(h) + '</span>'); });
  return o;
};
function autoHookSpec() {
  const words = ((scenes[0] && scenes[0].text) || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  for (let i = 0; i < words.length; i += 3) lines.push(words.slice(i, i + 3).join(' '));
  if (lines.length > 1 && lines[lines.length - 1].split(' ').length === 1)
    lines[lines.length - 2] += ' ' + lines.pop();
  return { style: 'stack', lines, hl: [] };
}
const HOOK_SPEC = job.hook || (process.env.HOOK_SPEC ? JSON.parse(process.env.HOOK_SPEC) : autoHookSpec());
function buildKhook(sp) {
  const st = sp.style || 'stack';
  const headerPill = `<div class="kh-pill" data-at="0.04"><span class="kh-dot"></span><span>CÂU HỎI NHIỀU NGƯỜI GẶP</span></div>`;
  if (st === 'flash') {
    const words = (sp.text || (sp.lines || []).join(' ') || scenes[0]?.text || '').split(/\s+/).filter(Boolean);
    const hlset = new Set((sp.hl || []).join(' ').split(/\s+/).filter(Boolean));
    const inner = words.map((w, i) =>
      `<span class="fw${hlset.has(w.replace(/[?.,!]/g, '')) || /\d/.test(w) ? ' hi' : ''}" data-at="${(0.12 + i * 0.14).toFixed(2)}">${esc(w)}</span>`).join(' ');
    return `<div id="khook" class="flash"><div class="khook-card">${headerPill}<div class="fl-wrap">${inner}</div></div></div>`;
  }
  if (st === 'slam') {
    return `<div id="khook" class="slam"><div class="khook-card">${headerPill}
      <div class="sub" data-at="0.14">${(sp.pre || []).map(esc).join('<br>')}</div>
      <div class="hero" data-at="0.28">${esc(sp.hero || '')}</div>
      <div class="sub" data-at="0.72">${(sp.post || []).map(esc).join('<br>')}</div></div></div>`;
  }
  if (st === 'highlight') {
    const rawLines = (sp.lines && sp.lines.length) ? sp.lines : autoHookSpec().lines;
    // Nếu AI quên truyền hlPhrase thì tự động tô sáng dòng cuối (thường là nút thắt/nỗi đau chính)
    const fallbackPhrase = !sp.hlPhrase && rawLines.length ? rawLines[rawLines.length - 1] : sp.hlPhrase;
    const lines = rawLines.map((ln, i) => {
      let html = esc(ln);
      if (fallbackPhrase && ln.includes(fallbackPhrase))
        html = esc(ln).split(esc(fallbackPhrase)).join(`<mark data-at="${(0.14 + i * 0.36 + 0.18).toFixed(2)}">${esc(fallbackPhrase)}</mark>`);
      return `<div class="kg" data-at="${(0.10 + i * 0.36).toFixed(2)}">${html}</div>`;
    }).join('');
    return `<div id="khook" class="highlight"><div class="khook-card">${headerPill}${lines}</div></div>`;
  }
  const rawLines = (sp.lines && sp.lines.length) ? sp.lines : autoHookSpec().lines;
  const hasHl = Array.isArray(sp.hl) && sp.hl.length > 0;
  const lines = rawLines.map((ln, i) => {
    const content = hasHl
      ? hlWrap(ln, sp.hl)
      : (i === rawLines.length - 1 ? `<mark data-at="${(0.14 + i * 0.36 + 0.18).toFixed(2)}">${esc(ln)}</mark>` : esc(ln));
    return `<div class="kg" data-at="${(0.10 + i * 0.36).toFixed(2)}">${content}</div>`;
  }).join('');
  return `<div id="khook" class="stack"><div class="khook-card">${headerPill}${lines}</div></div>`;
}
const khookHtml = buildKhook(HOOK_SPEC);

const badgeScene = scenes.find((s) => s.overlay?.price_badge);
let badgeHtml = '';
if (badgeScene) {
  const p = badgeScene.prod || {};
  const priceK = String(Math.round((p.price_vnd || 0) / 1000));
  const regK = p.regular_vnd ? Math.round(p.regular_vnd / 1000) : null;
  // DigitRoll (video-shotcraft/DigitRoll.tsx): mỗi chữ số là 1 băng cuộn dọc 0..90..9
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

const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<link rel="stylesheet" href="assets/fonts/fonts.css">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px;overflow:hidden;background:${bg};
    font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  #frame{position:absolute;inset:0;perspective:1400px}

  /* nền: hai vũng sáng + lưới studio tinh tế */
  #bg{position:absolute;inset:0;background:
    radial-gradient(120% 60% at 50% -8%, #16244a 0%, rgba(11,27,46,0) 55%),
    radial-gradient(90% 50% at 50% 120%, #101a33 0%, rgba(11,27,46,0) 60%),
    ${bg}}
  #bg-grid{position:absolute;inset:0;z-index:1;pointer-events:none;opacity:.07;
    background-image:linear-gradient(rgba(159,176,196,.4) 1px,transparent 1px),
      linear-gradient(90deg,rgba(159,176,196,.4) 1px,transparent 1px);
    background-size:54px 54px}

  /* [V2] nền động từ ảnh sản phẩm: mờ + tối + phủ vignette navy */
  #ambient{position:absolute;inset:0;z-index:0}
  #ambient .amb{position:absolute;inset:-8%;opacity:0;background-size:cover;background-position:center;
    filter:blur(52px) saturate(1.3) brightness(.48);will-change:opacity,transform}
  #ambient::after{content:"";position:absolute;inset:0;pointer-events:none;background:
    radial-gradient(110% 70% at 50% 42%, rgba(11,27,46,.18) 0%, rgba(11,27,46,.76) 64%, rgba(8,18,32,.95) 100%)}

  /* Header thương hiệu chuẩn vùng an toàn */
  #topbar{position:absolute;top:76px;left:72px;right:72px;z-index:42;
    display:flex;align-items:center;justify-content:space-between}
  .brand-pill{display:inline-flex;align-items:center;gap:14px;
    background:rgba(11,27,46,.82);border:1.5px solid rgba(159,176,196,.24);
    padding:10px 22px 10px 12px;border-radius:99px;backdrop-filter:blur(12px);
    box-shadow:0 12px 30px rgba(0,0,0,.4)}
  .brand-logo-wrap{width:52px;height:52px;border-radius:50%;background:#FFFFFF;
    display:flex;align-items:center;justify-content:center;padding:7px;
    box-shadow:0 2px 10px rgba(0,0,0,.25)}
  .brand-logo-wrap img{width:100%;height:100%;object-fit:contain;display:block}
  .brand-meta{display:flex;flex-direction:column;gap:2px}
  .brand-name{color:#FFFFFF;font-size:24px;font-weight:800;letter-spacing:-.3px;line-height:1.1}
  .brand-sub{color:${accent};font-size:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase}

  .role-pill{display:inline-flex;align-items:center;gap:10px;
    background:rgba(11,27,46,.82);border:1.5px solid rgba(201,162,39,.45);
    padding:12px 24px;border-radius:99px;color:#FFFFFF;font-size:21px;font-weight:800;
    letter-spacing:1px;backdrop-filter:blur(12px);box-shadow:0 10px 28px rgba(0,0,0,.35)}
  .role-pill .rp-icon{color:${accent};font-size:22px}

  /* Thanh tên sản phẩm phía trên khung ảnh */
  #prod-bar{position:absolute;top:174px;left:72px;right:72px;z-index:36;
    display:flex;justify-content:center;pointer-events:none;opacity:0}
  .prod-title-pill{display:inline-flex;align-items:center;gap:10px;max-width:920px;
    background:rgba(11,27,46,.68);border:1px solid rgba(159,176,196,.2);
    padding:10px 26px;border-radius:16px;color:#9FB0C4;font-size:24px;font-weight:700;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(8px)}
  .prod-title-pill b{color:#FFFFFF;font-weight:800}

  /* Khung sản phẩm 3D Studio + Spec Chips */
  .scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    opacity:0;padding:250px 110px 640px;perspective:1400px}
  .card-stage{position:relative;width:820px;height:820px;display:flex;align-items:center;justify-content:center;
    transform-style:preserve-3d;will-change:transform}
  .card-glow{position:absolute;inset:-36px;border-radius:56px;
    background:radial-gradient(circle at 50% 50%, rgba(201,162,39,.28) 0%, rgba(201,162,39,0) 70%);
    opacity:.65;pointer-events:none}
  .card{position:relative;width:820px;height:820px;border-radius:36px;overflow:hidden;background:#fff;
    box-shadow:0 55px 120px -30px rgba(0,0,0,.85), 0 0 0 2px rgba(255,255,255,.16),
      0 0 40px -10px rgba(201,162,39,.22);will-change:transform}
  .card img{width:100%;height:100%;object-fit:cover;display:block;will-change:transform}
  .card-sheen{position:absolute;inset:-40%;pointer-events:none;
    background:linear-gradient(115deg, transparent 38%, rgba(255,255,255,.38) 50%, transparent 62%);
    transform:translateX(-120%) rotate(8deg);will-change:transform}
  .card-ring{position:absolute;inset:0;border-radius:36px;pointer-events:none;
    box-shadow:inset 0 0 0 2px rgba(255,255,255,.35), inset 0 0 28px rgba(11,27,46,.12)}

  /* [3D CUTOUT STUDIO MODE + SHOTCRAFT OUTLINE-WORD-FILL HUD] */
  .cutout-stage{width:860px;height:840px}
  .studio-halo{position:absolute;width:760px;height:760px;border-radius:50%;pointer-events:none;
    background:
      radial-gradient(circle at 50% 46%, rgba(201,162,39,.34) 0%, rgba(22,36,74,.48) 44%, rgba(11,27,46,0) 72%)}
  .shotcraft-dial{position:absolute;width:780px;height:780px;pointer-events:none;z-index:2;
    overflow:visible;will-change:transform,opacity}
  .depth-hero{position:absolute;top:-38px;left:-90px;right:-90px;z-index:3;
    display:flex;justify-content:center;align-items:center;pointer-events:none;
    font-family:'Helvetica Neue','Inter',sans-serif;font-size:148px;font-weight:900;
    letter-spacing:-4px;line-height:1;white-space:nowrap;will-change:transform,opacity}
  .depth-hero .dh-outline{color:transparent;-webkit-text-stroke:3px rgba(201,162,39,.78)}
  .depth-hero .dh-solid{position:absolute;color:rgba(255,248,225,.92);opacity:0;
    text-shadow:0 0 28px rgba(255,255,255,.75), 0 0 68px rgba(201,162,39,.72)}
  .studio-orbit{position:absolute;width:720px;height:720px;border-radius:50%;pointer-events:none;
    border:2px dashed rgba(201,162,39,.32);
    box-shadow:0 0 40px rgba(201,162,39,.15), inset 0 0 40px rgba(201,162,39,.12);
    transform:translateY(210px) rotateX(74deg)}
  .studio-pedestal{position:absolute;bottom:22px;width:540px;height:96px;border-radius:50%;pointer-events:none;
    background:radial-gradient(closest-side, rgba(0,0,0,.82) 0%, rgba(201,162,39,.26) 55%, rgba(11,27,46,0) 100%);
    filter:blur(4px);will-change:transform,opacity}
  .cutout-wrap{position:relative;width:780px;height:740px;display:flex;align-items:center;justify-content:center;
    z-index:5;will-change:transform}
  .cutout-img{width:100%;height:100%;object-fit:contain;display:block;
    filter:drop-shadow(0 40px 44px rgba(0,0,0,.82)) drop-shadow(0 0 30px rgba(201,162,39,.24))}
  .cutout-shine-mask{position:absolute;inset:0;pointer-events:none;z-index:6;
    -webkit-mask-size:contain;mask-size:contain;
    -webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;
    -webkit-mask-position:center;mask-position:center}
  .cutout-beam{background:linear-gradient(115deg, transparent 34%, rgba(255,255,255,.78) 50%, transparent 66%)}

  /* Floating Bento Spec Chips */
  .spec-chips{position:absolute;left:-16px;right:-16px;bottom:-34px;z-index:25;
    display:flex;flex-wrap:wrap;justify-content:center;gap:14px;pointer-events:none}
  .spec-chip{display:inline-flex;align-items:center;gap:12px;
    background:rgba(11,27,46,.92);border:2px solid ${accent};
    padding:14px 26px;border-radius:99px;color:#FFFFFF;font-size:31px;font-weight:800;
    letter-spacing:-.3px;box-shadow:0 18px 40px rgba(0,0,0,.65), 0 0 20px rgba(201,162,39,.25);
    backdrop-filter:blur(12px);opacity:0;transform:translateY(24px) scale(.85);will-change:transform,opacity}
  .spec-chip .sc-dot{width:12px;height:12px;border-radius:50%;background:${accent};
    box-shadow:0 0 10px ${accent};flex-shrink:0}

  /* Badge giá — góc trên phải vùng an toàn (theo rules/visual.md) */
  .badge{position:absolute;top:186px;right:72px;z-index:44;display:none;
    flex-direction:column;align-items:flex-end;gap:6px;
    background:rgba(11,27,46,.92);border:3px solid ${accent};border-radius:28px;
    padding:22px 32px;backdrop-filter:blur(16px);
    box-shadow:0 28px 65px rgba(0,0,0,.75), 0 0 36px rgba(201,162,39,.35)}
  .badge-top{display:flex;align-items:center;gap:12px}
  .badge .from{color:${accent};font-size:25px;font-weight:800;letter-spacing:2px}
  .badge .tag{background:${accent};color:#0B1B2E;font-weight:900;
    font-size:23px;padding:4px 14px;border-radius:10px;letter-spacing:.5px}
  .badge .now{color:#FFFFFF;font-size:88px;font-weight:900;line-height:1;letter-spacing:-2px;
    text-shadow:0 6px 24px rgba(201,162,39,.4)}
  .badge .digit-roll{display:inline-flex;align-items:baseline;height:88px;overflow:hidden}
  .badge .d-col{display:inline-block;height:88px;overflow:hidden}
  .badge .d-strip{display:block;will-change:transform}
  .badge .d-strip b{display:block;height:88px;line-height:88px;font-weight:900;font-variant-numeric:tabular-nums}
  .badge .d-static{display:inline-block;height:88px;line-height:88px}
  .badge .was{color:#9FB0C4;font-size:32px;font-weight:700;text-decoration:line-through}

  /* Thanh cam kết chính hãng ở cảnh CTA */
  #cta-strip{position:absolute;left:64px;right:64px;bottom:645px;z-index:43;
    display:none;justify-content:center;gap:14px;flex-wrap:wrap;pointer-events:none}
  .cta-pill{display:inline-flex;align-items:center;gap:10px;
    background:rgba(11,27,46,.9);border:1.5px solid rgba(159,176,196,.3);
    padding:14px 24px;border-radius:99px;color:#FFFFFF;font-size:27px;font-weight:800;
    box-shadow:0 16px 38px rgba(0,0,0,.55);opacity:0;transform:translateY(20px) scale(.9)}
  .cta-pill.gold{background:${accent};color:#0B1B2E;border-color:${accent};
    box-shadow:0 16px 38px rgba(201,162,39,.45)}

  /* [V2] Kinetic Hook — Card nổi bật 3 giây đầu */
  #khook{position:absolute;inset:0;z-index:41;display:flex;flex-direction:column;
    align-items:center;justify-content:center;padding:60px 68px 180px;text-align:center;opacity:0}
  #khook::before{content:"";position:absolute;inset:0;z-index:-1;background:
    radial-gradient(88% 64% at 50% 45%, rgba(11,27,46,.62) 0%, rgba(8,18,32,.92) 80%)}
  .khook-card{display:flex;flex-direction:column;align-items:center;gap:20px;width:100%;
    background:rgba(11,27,46,.82);border:2px solid rgba(201,162,39,.42);
    border-radius:38px;padding:44px 48px 50px;backdrop-filter:blur(18px);
    box-shadow:0 36px 90px rgba(0,0,0,.78), inset 0 1px 0 rgba(255,255,255,.16)}
  .kh-pill{display:inline-flex;align-items:center;gap:12px;
    background:rgba(201,162,39,.16);border:1.5px solid ${accent};
    padding:10px 24px;border-radius:99px;color:${accent};font-size:23px;font-weight:800;
    letter-spacing:1.5px;margin-bottom:8px;opacity:0}
  .kh-dot{width:12px;height:12px;border-radius:50%;background:${accent};box-shadow:0 0 10px ${accent}}
  #khook .kg{font-weight:900;font-size:84px;line-height:1.1;letter-spacing:-1.5px;color:#fff;
    opacity:0;transform:translateY(28px) scale(.9);text-shadow:0 8px 34px rgba(0,0,0,.6);text-wrap:balance}
  #khook .kg .hi{color:${accent}}
  #khook .kg mark{background:${accent};color:#0B1B2E;padding:2px 18px 6px;border-radius:16px;
    display:inline-block;transform:scaleX(0);transform-origin:left center;text-shadow:none;
    box-shadow:0 12px 32px rgba(201,162,39,.45)}
  #khook.highlight .khook-card{align-items:center;text-align:center}
  /* word flash */
  #khook.flash .fl-wrap{font-weight:900;font-size:84px;line-height:1.12;letter-spacing:-1px;color:#fff;
    text-shadow:0 8px 34px rgba(0,0,0,.6);text-wrap:balance}
  #khook.flash .fw{display:inline-block;opacity:0;transform:scale(.6)}
  #khook.flash .fw.hi{color:#0B1B2E;background:${accent};padding:2px 14px;border-radius:14px;text-shadow:none}
  /* number slam */
  #khook.slam .sub{font-weight:800;font-size:60px;line-height:1.12;color:#fff;opacity:0;
    transform:translateY(18px);text-shadow:0 6px 26px rgba(0,0,0,.6)}
  #khook.slam .hero{font-weight:900;font-size:230px;line-height:.88;color:${accent};opacity:0;
    letter-spacing:-5px;text-shadow:0 12px 50px rgba(201,162,39,.45);margin:6px 0}

  /* Hiệu ứng nháy sáng nhẹ khi cắt cảnh cao trào */
  #cut-flash{position:absolute;inset:0;z-index:40;pointer-events:none;
    background:radial-gradient(circle at 50% 45%, rgba(255,255,255,.35), rgba(201,162,39,.12) 60%, transparent 100%);
    opacity:0}
</style></head>
<body>
  <div id="frame">
    <div id="bg"></div>
    <div id="bg-grid"></div>
    <div id="ambient">${ambientLayers}</div>
    ${sceneLayers}
    <div id="cut-flash"></div>
    <div id="topbar">
      <div class="brand-pill">
        <div class="brand-logo-wrap"><img src="assets/logo.png" alt="Lucas"></div>
        <div class="brand-meta">
          <span class="brand-name">Lucas Combo</span>
          <span class="brand-sub">Phụ kiện chính hãng</span>
        </div>
      </div>
      <div class="role-pill" id="role-pill"><span class="rp-icon" id="rp-icon">⚡</span><span id="rp-text">GÓC HỎI ĐÁP</span></div>
    </div>
    <div id="prod-bar">
      <div class="prod-title-pill">Sản phẩm: <b>${shortProdName}</b></div>
    </div>
    ${badgeHtml}
    ${ctaStripHtml}
    ${khookHtml}
  </div>

<script type="module">
${component}

const scenes = ${JSON.stringify(scenes.map((s) => ({ i: s.idx, role: s.role, start: s.start, end: s.end })))};
const ROLE_META = ${JSON.stringify(ROLE_META)};
const FADE = ${FADE};
const TOTAL = ${total};
const frame = document.getElementById('frame');
const sub = mountSubtitles(frame, ${JSON.stringify(cues)}, { accent: '${accent}' });

const layers = [...document.querySelectorAll('.scene')];
const stages = layers.map((l) => l.querySelector('.card-stage'));
const cards = layers.map((l) => l.querySelector('.card'));
const imgs = layers.map((l) => l.querySelector('.card-img'));
const cutoutWraps = layers.map((l) => l.querySelector('.cutout-wrap'));
const pedestals = layers.map((l) => l.querySelector('.studio-pedestal'));
const orbits = layers.map((l) => l.querySelector('.studio-orbit'));
const dials = layers.map((l) => l.querySelector('.shotcraft-dial'));
const dialOuters = layers.map((l) => l.querySelector('.dial-outer'));
const dialInners = layers.map((l) => l.querySelector('.dial-inner'));
const depthHeroes = layers.map((l) => l.querySelector('.depth-hero'));
const dhOutlines = layers.map((l) => l.querySelector('.dh-outline'));
const dhSolids = layers.map((l) => l.querySelector('.dh-solid'));
const sheens = layers.map((l) => l.querySelector('.card-sheen'));
const chipGroups = layers.map((l) => [...l.querySelectorAll('.spec-chip')]);
const ambs = [...document.querySelectorAll('#ambient .amb')];
const badge = document.querySelector('.badge');
const badgeScene = badge ? Number(badge.dataset.scene) : -1;
const digitCols = badge ? [...badge.querySelectorAll('.d-col')] : [];
const ctaStrip = document.getElementById('cta-strip');
const ctaPills = ctaStrip ? [...ctaStrip.querySelectorAll('.cta-pill')] : [];
const prodBar = document.getElementById('prod-bar');
const rpIcon = document.getElementById('rp-icon');
const rpText = document.getElementById('rp-text');
const cutFlash = document.getElementById('cut-flash');

// [V2] kinetic hook refs
const KHOOK_END = ${hookEnd};
const khook = document.getElementById('khook');
const kEls = khook ? [...khook.querySelectorAll('[data-at]')] : [];
const khStyle = khook ? khook.className : '';

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const c01 = (x) => Math.max(0, Math.min(1, x));

// Ken Burns + góc nghiêng 3D nhẹ cho từng cảnh
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
  // Tìm cảnh hiện tại để cập nhật Role Pill & Product Bar
  const curScene = scenes.find((s) => t >= s.start && t < s.end) || scenes[0];
  if (curScene && ROLE_META[curScene.role]) {
    rpIcon.textContent = ROLE_META[curScene.role].icon;
    rpText.textContent = ROLE_META[curScene.role].tag;
  }
  if (prodBar) {
    const showProdBar = t >= KHOOK_END && curScene && curScene.role !== 'price';
    prodBar.style.opacity = showProdBar ? '1' : '0';
  }

  // Hiệu ứng flash nhẹ ở thời điểm cắt cảnh (từ cảnh 1 trở đi)
  let flashOp = 0;
  for (let i = 1; i < scenes.length; i++) {
    const dt = t - scenes[i].start;
    if (dt >= -0.04 && dt <= 0.16) {
      const fp = 1 - Math.abs(dt - 0.04) / 0.12;
      flashOp = Math.max(flashOp, Math.max(0, fp) * (scenes[i].role === 'price' ? 0.65 : 0.32));
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

    // Chuyển cảnh Zoom-Punch / Whip-Slide trong 0.28s đầu mỗi cảnh
    const enterP = smooth(c01((localT + 0.06) / 0.28));
    const punchBounce = Math.sin(enterP * Math.PI);
    const enterY = (i % 2 === 1 ? 1 : -1) * (1 - enterP) * 42;
    const stageScale = (0.90 + 0.10 * enterP) + 0.035 * punchBounce;
    const curRx = rx * (0.4 + 0.6 * e);
    const curRy = ry * (e - 0.5) * 1.8;

    stages[i].style.transform =
      'translateY(' + enterY.toFixed(1) + 'px) scale(' + stageScale.toFixed(3) + ') rotateX(' + curRx.toFixed(2) + 'deg) rotateY(' + curRy.toFixed(2) + 'deg)';

    const imgScale = 1.02 + 0.08 * e; // tuân thủ rules/visual.md: zoom chậm 1.0 -> 1.08
    if (imgs[i]) {
      imgs[i].style.transform =
        'translate(' + (dx * 22 * (e - 0.5)).toFixed(1) + 'px, ' + (dy * 22 * (e - 0.5)).toFixed(1) + 'px) scale(' + imgScale.toFixed(4) + ')';
    }

    // Chuyển động 3D Cutout: nảy spring từ dưới lên + bay lơ lửng (levitation) + bóng sàn co giãn ngược pha
    if (cutoutWraps[i]) {
      const popP = smooth(c01((localT + 0.04) / 0.36));
      const popOvershoot = Math.sin(popP * Math.PI);
      const floatWave = Math.sin(localT * 2.8);
      const levY = (1 - popP) * 95 + floatWave * 13;
      const cutScale = (0.76 + 0.26 * popP + 0.06 * popOvershoot) * (1 + 0.04 * e);
      const cutRot = (dx || 1) * floatWave * 1.6;
      cutoutWraps[i].style.transform =
        'translateY(' + levY.toFixed(1) + 'px) scale(' + cutScale.toFixed(3) + ') rotateZ(' + cutRot.toFixed(2) + 'deg)';
      if (pedestals[i]) {
        const pedScale = (0.65 + 0.35 * popP) * (1 - floatWave * 0.09);
        pedestals[i].style.transform = 'scale(' + pedScale.toFixed(3) + ')';
        pedestals[i].style.opacity = (0.78 - floatWave * 0.14).toFixed(3);
      }
      if (orbits[i]) {
        orbits[i].style.transform = 'translateY(210px) rotateX(74deg) rotateZ(' + (localT * 22).toFixed(1) + 'deg)';
      }
      // Shotcraft OutlineWordFill: Thước ngắm 72 vạch + Đại tự 3D sau lưng sản phẩm thu nhỏ & phát sáng
      if (dials[i]) {
        const dialP = smooth(c01((localT - 0.04) / 0.95));
        const dialScale = 1.48 - 0.48 * dialP;
        const lit = localT >= 0.54 ? 1 : 0;
        const outRot = (Math.min(localT, 0.54) * 18 + (lit ? 4 * smooth(c01((localT - 0.54) / 0.35)) : 0));
        const inRot = -localT * 11;
        dials[i].style.opacity = (0.85 * smooth(c01(localT / 0.25))).toFixed(3);
        dials[i].style.transform = 'scale(' + dialScale.toFixed(4) + ')';
        if (dialOuters[i]) dialOuters[i].setAttribute('transform', 'rotate(' + outRot.toFixed(2) + ')');
        if (dialInners[i]) dialInners[i].setAttribute('transform', 'rotate(' + inRot.toFixed(2) + ')');
      }
      if (depthHeroes[i]) {
        const shrinkP = smooth(c01((localT - 0.02) / 0.36));
        const ws = 2.15 - 1.15 * shrinkP;
        const lit = localT >= 0.54 ? 1 : 0;
        const flash = lit * (1 - smooth(c01((localT - 0.54) / 0.32)));
        const driftX = -dx * 18 * (e - 0.5);
        depthHeroes[i].style.opacity = smooth(c01(localT / 0.18)).toFixed(3);
        depthHeroes[i].style.transform = 'translateX(' + driftX.toFixed(1) + 'px) scale(' + ws.toFixed(4) + ')';
        if (dhOutlines[i]) dhOutlines[i].style.opacity = (1 - lit * 0.65).toFixed(3);
        if (dhSolids[i]) {
          dhSolids[i].style.opacity = (lit * (0.42 + 0.58 * flash)).toFixed(3);
        }
      }
    }

    // Vệt sáng ánh kim (sheen) quét ngang qua thẻ / thân sản phẩm cutout
    if (sheens[i]) {
      const sheenCycle = (localT - 0.1) % 2.4;
      const sheenP = c01(sheenCycle / 0.78);
      const sheenX = -120 + 260 * smooth(sheenP);
      sheens[i].style.transform = 'translateX(' + sheenX.toFixed(1) + '%) rotate(12deg)';
    }

    // Floating Spec Chips nảy ra lần lượt
    if (chipGroups[i] && chipGroups[i].length) {
      chipGroups[i].forEach((chip, ci) => {
        const chipStart = 0.18 + ci * 0.22;
        const cp = smooth(c01((localT - chipStart) / 0.26));
        const cb = Math.sin(cp * Math.PI);
        const cScale = 0.84 + 0.16 * cp + 0.06 * cb;
        const cY = (1 - cp) * 24;
        chip.style.opacity = cp.toFixed(3);
        chip.style.transform = 'translateY(' + cY.toFixed(1) + 'px) scale(' + cScale.toFixed(3) + ')';
      });
    }

    // [V2] nền động: crossfade theo cảnh + trôi NGƯỢC hướng card -> chiều sâu
    if (ambs[i]) {
      ambs[i].style.opacity = alive ? (0.92 * fadeIn) : 0;
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
      // Shotcraft DigitRoll: cuộn từng cột số 0..9 mượt mà lệch pha 0.12s mỗi cột
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

  // CTA Trust Strip ở cảnh cuối
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

  // [V2] kinetic hook: hiện 3 giây đầu, từng cụm nảy vào, rồi mờ đi
  if (khook) {
    let ov = 0;
    if (t < KHOOK_END) {
      const fin = smooth(t / 0.24);
      const fout = 1 - smooth((t - (KHOOK_END - 0.28)) / 0.28);
      ov = Math.max(0, Math.min(fin, fout));
    }
    khook.style.opacity = ov.toFixed(3);
    kEls.forEach((el) => {
      const at = parseFloat(el.dataset.at);
      const p = smooth(c01((t - at) / 0.36));
      if (el.tagName === 'MARK') {
        const b = Math.sin(p * Math.PI);
        el.style.transform = 'scaleX(' + p.toFixed(3) + ') scaleY(' + (1 + 0.06 * b).toFixed(3) + ')';
        return;
      }
      el.style.opacity = p.toFixed(3);
      const blurPx = (1 - p) * 14;
      el.style.filter = blurPx > 0.2 ? 'blur(' + blurPx.toFixed(1) + 'px)' : 'none';
      if (el.classList.contains('hero')) {
        el.style.transform = 'scale(' + (1.32 - 0.32 * p + 0.06 * Math.sin(p * Math.PI)).toFixed(3) + ')';
      } else if (el.classList.contains('fw')) {
        el.style.transform = 'scale(' + (0.6 + 0.4 * p + 0.08 * Math.sin(p * Math.PI)).toFixed(3) + ')';
      } else {
        const sc = 0.90 + 0.10 * p + 0.04 * Math.sin(p * Math.PI);
        el.style.transform = 'translateY(' + (34 * (1 - p)).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')';
      }
    });
    // ẩn phụ đề đáy khi kinetic hook đang chạy (khỏi trùng câu)
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
