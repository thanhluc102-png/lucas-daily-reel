#!/usr/bin/env node
/**
 * VALIDATOR — chạy TRƯỚC mọi lần render.
 *
 *   node scripts/validate.mjs jobs/2026-07-22_a1b2c.json
 *   node scripts/validate.mjs jobs/*.json
 *
 * Thoát mã 0 = qua. Mã 1 = có ERROR, không được render.
 * Không cần cài gì thêm.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROLES = ['hook', 'body', 'proof', 'price', 'cta'];
const FORMATS = ['hook', 'premium', 'unbox', 'podcast', 'threads'];
const ASSET_TYPES = ['product_image', 'ai_image', 'stock_video', 'existing_footage'];

const BANNED_OPENERS = [
  'chào các bạn', 'xin chào', 'hôm nay mình sẽ', 'hôm nay mình xin',
  'bạn có biết rằng', 'chào mọi người',
];

const BANNED_WORDS = [
  'cực kỳ', 'siêu phẩm', 'đỉnh cao', 'không thể bỏ qua',
  'must-have', 'must have', 'xịn xò', 'chất lượng tuyệt vời',
  'nhanh tay kẻo hết', 'số lượng có hạn',
];

const FROM_MARKERS = ['chỉ từ', 'chỉ  từ', 'giá từ', ' từ '];

// Thương hiệu thật — AI vẽ logo ra là hàng nhái, cấm nhắc trong prompt
const BRAND_WORDS = [
  'apple', 'macbook', 'iphone', 'ipad', 'airpods', 'tomtoc', 'pitaka',
  'anker', 'jcpal', 'innostyle', 'satechi', 'wiwu', 'samsung', 'xiaomi',
];

// Danh từ sản phẩm — cảnh báo, vì có thể vẫn hợp lệ (ẩn dụ, nền)
const PRODUCT_NOUNS = [
  'backpack', 'phone case', 'laptop case', 'charger', 'power bank',
  'cable', 'screen protector', 'keyboard', 'mouse', 'hub', 'dock',
];

// ---------------------------------------------------------------------------

class Report {
  constructor(file) {
    this.file = file;
    this.errors = [];
    this.warns = [];
  }
  err(where, msg) { this.errors.push({ where, msg }); }
  warn(where, msg) { this.warns.push({ where, msg }); }
  get ok() { return this.errors.length === 0; }
}

const norm = (s) => s.toLowerCase().normalize('NFC').replace(/\s+/g, ' ').trim();

/** Rút mọi con số tiền xuất hiện trong câu, trả về đơn vị đồng. */
function extractPrices(text) {
  const out = [];
  const t = text.replace(/\u00a0/g, ' ');

  // 590K / 590k / 590 K
  for (const m of t.matchAll(/(\d{1,4})\s*[kK](?![a-zA-Z])/g)) {
    out.push(Number(m[1]) * 1000);
  }
  // 1tr290 / 1 triệu 290
  for (const m of t.matchAll(/(\d{1,2})\s*(?:tr|triệu)\s*(\d{1,3})?/gi)) {
    out.push(Number(m[1]) * 1_000_000 + (m[2] ? Number(m[2]) * 1000 : 0));
  }
  // 590.000đ / 590,000 vnd / 1.290.000
  for (const m of t.matchAll(/(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|d|vnđ|vnd)?/gi)) {
    out.push(Number(m[1].replace(/[.,]/g, '')));
  }
  return [...new Set(out)];
}

function extractPercents(text) {
  return [...text.matchAll(/(\d{1,2})\s*%/g)].map((m) => Number(m[1]));
}

// ---------------------------------------------------------------------------

function validate(job, file) {
  const r = new Report(file);

  // ---- cấu trúc -----------------------------------------------------------
  if (job.version !== 1) r.err('version', 'phải là 1');
  if (!/^\d{4}-\d{2}-\d{2}_[a-z0-9]{5}$/.test(job.job_id || ''))
    r.err('job_id', 'sai định dạng, cần YYYY-MM-DD_xxxxx');
  if (!FORMATS.includes(job.format)) r.err('format', `phải thuộc ${FORMATS.join(', ')}`);
  if (job.aspect && job.aspect !== '9:16') r.err('aspect', 'chỉ chấp nhận 9:16');
  if (!Array.isArray(job.products) || !job.products.length) r.err('products', 'thiếu sản phẩm');
  if (!Array.isArray(job.scenes) || job.scenes.length < 3) r.err('scenes', 'cần ít nhất 3 cảnh');
  if (!job.cta?.text || !job.cta?.url) r.err('cta', 'thiếu text hoặc url');
  if (r.errors.length) return r; // hỏng cấu trúc thì kiểm tiếp vô nghĩa

  const bySku = new Map(job.products.map((p) => [p.sku, p]));

  // ---- sản phẩm -----------------------------------------------------------
  for (const p of job.products) {
    if (p.regular_vnd && p.regular_vnd > p.price_vnd) {
      const real = Math.round((1 - p.price_vnd / p.regular_vnd) * 100);
      if (p.discount_pct !== undefined && Math.abs(p.discount_pct - real) > 1)
        r.err(`products.${p.sku}`, `discount_pct=${p.discount_pct}% nhưng tính ra ${real}%`);
    }
    if (p.regular_vnd && p.regular_vnd < p.price_vnd)
      r.err(`products.${p.sku}`, 'giá gốc thấp hơn giá bán');
  }

  // ---- cảnh ---------------------------------------------------------------
  const roles = job.scenes.map((s) => s.role);

  if (roles[0] !== 'hook') r.err('scenes[0]', 'cảnh đầu tiên phải có role=hook');
  if (roles.filter((x) => x === 'hook').length !== 1) r.err('scenes', 'phải có đúng 1 cảnh hook');
  if (roles.at(-1) !== 'cta') r.err('scenes', 'cảnh cuối phải có role=cta');
  if (roles.filter((x) => x === 'cta').length !== 1) r.err('scenes', 'phải có đúng 1 cảnh cta');

  let total = 0;

  job.scenes.forEach((s, i) => {
    const at = `scenes[${i}]`;
    if (s.idx !== i) r.err(at, `idx=${s.idx} không khớp vị trí ${i}`);
    if (!ROLES.includes(s.role)) r.err(at, `role không hợp lệ: ${s.role}`);
    if (!ASSET_TYPES.includes(s.asset?.type)) r.err(at, 'asset.type không hợp lệ');
    if (s.asset?.type === 'ai_image' && !s.asset.prompt) r.err(at, 'ai_image thiếu prompt');

    // ---- ảnh AI không được vẽ sản phẩm ------------------------------------
    if (s.asset?.type === 'ai_image') {
      const p = norm(s.asset.prompt || '');

      if (s.sku_ref)
        r.err(at, 'cảnh ai_image không được gắn sku_ref — ảnh sản phẩm phải là product_image, xem rules/imagery.md');

      if (s.overlay?.price_badge)
        r.err(at, 'không đặt badge giá lên ảnh AI — dễ hiểu nhầm đó là ảnh sản phẩm thật');

      for (const b of BRAND_WORDS)
        if (p.includes(b)) r.err(at, `prompt nhắc thương hiệu "${b}" — AI vẽ logo ra là nhãn hiệu nhái, xem rules/imagery.md`);

      for (const b of PRODUCT_NOUNS)
        if (p.includes(b))
          r.warn(at, `prompt có "${b}" — nếu khung hình có món đang bán thì phải đổi sang product_image`);

      for (const need of ['no text', 'no logo']) {
        if (!p.includes(need))
          r.err(at, `prompt thiếu "${need}" — bắt buộc theo rules/imagery.md`);
      }
    }
    if (s.asset?.src && !/^https?:\/\//.test(s.asset.src) && !fs.existsSync(s.asset.src))
      r.err(at, `không tìm thấy file: ${s.asset.src}`);

    total += s.duration_sec;

    const words = s.text.trim().split(/\s+/).length;
    if (words > 16) r.err(at, `${words} từ — quá 16, đọc không kịp và phụ đề tràn khung`);
    if (words < 4) r.warn(at, `chỉ ${words} từ — hơi cụt`);

    const readTime = words / 3.2; // ~3.2 từ/giây tiếng Việt
    if (readTime > s.duration_sec + 0.4)
      r.err(at, `cần ~${readTime.toFixed(1)}s để đọc nhưng chỉ có ${s.duration_sec}s`);

    const t = norm(s.text);

    if (s.role === 'hook') {
      if (s.duration_sec > 3.5) r.err(at, 'hook không được dài quá 3.5s');
      for (const b of BANNED_OPENERS)
        if (t.startsWith(b)) r.err(at, `hook mở bằng "${b}" — cấm, xem rules/editorial.md`);
    }

    for (const w of BANNED_WORDS)
      if (t.includes(w)) r.err(at, `dùng từ bị cấm: "${w}"`);

    if (s.sku_ref && !bySku.has(s.sku_ref)) r.err(at, `sku_ref không có trong products: ${s.sku_ref}`);

    // ---- BẪY GIÁ: kiểm tra kỹ nhất ---------------------------------------
    const prices = extractPrices(s.text);
    if (prices.length) {
      const p = s.sku_ref ? bySku.get(s.sku_ref) : job.products[0];

      for (const money of prices) {
        const matchSale = money === p.price_vnd;
        const matchRegular = p.regular_vnd && money === p.regular_vnd;

        if (!matchSale && !matchRegular) {
          r.err(at, `nhắc giá ${money.toLocaleString('vi-VN')}đ nhưng ${p.sku} có giá ${p.price_vnd.toLocaleString('vi-VN')}đ` +
            (p.regular_vnd ? ` (gốc ${p.regular_vnd.toLocaleString('vi-VN')}đ)` : ''));
        }

        if (matchSale && p.price_is_from) {
          const hasMarker = FROM_MARKERS.some((m) => t.includes(m));
          if (!hasMarker)
            r.err(at, `${p.sku} là sản phẩm biến thể (price_is_from) — câu nhắc giá BẮT BUỘC có "chỉ từ". Đây là lỗi quảng cáo sai giá.`);
          if (s.overlay?.price_badge === false || !s.overlay?.price_badge)
            r.warn(at, 'nên bật overlay.price_badge để badge in chữ "CHỈ TỪ"');
        }
      }
    }

    for (const pct of extractPercents(s.text)) {
      const p = s.sku_ref ? bySku.get(s.sku_ref) : job.products[0];
      if (p.discount_pct !== undefined && pct !== p.discount_pct)
        r.err(at, `nói giảm ${pct}% nhưng ${p.sku} giảm ${p.discount_pct}%`);
    }
  });

  // ---- tổng thể -----------------------------------------------------------
  if (total < 15) r.err('scenes', `tổng ${total.toFixed(1)}s — quá ngắn, tối thiểu 15s`);
  if (total > 60) r.err('scenes', `tổng ${total.toFixed(1)}s — quá dài, tối đa 60s`);
  if (total > 35) r.warn('scenes', `${total.toFixed(1)}s — dài hơn vùng hiệu quả 22–35s`);

  const bpm = job.audio?.bpm ?? 195;
  if (job.format === 'hook' && bpm !== 195)
    r.warn('audio.bpm', `format hook thường chạy 195 BPM, đang để ${bpm}`);

  const priceScenes = job.scenes.map((s, i) => (s.role === 'price' ? i : -1)).filter((i) => i >= 0);
  if (!priceScenes.length) {
    if (job.format !== 'podcast') r.warn('scenes', 'không có cảnh role=price');
  } else {
    const pos = priceScenes[0] / (job.scenes.length - 1);
    if (pos < 0.4) r.warn(`scenes[${priceScenes[0]}]`, 'cảnh giá đặt hơi sớm, nên ở khoảng 60–70% thời lượng');
  }

  if (!/lucas\.vn/i.test(job.cta.url)) r.err('cta.url', 'phải trỏ về lucas.vn');

  return r;
}

// ---------------------------------------------------------------------------

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Dùng: node scripts/validate.mjs <file.json> [file2.json ...]');
  process.exit(2);
}

let failed = 0;

for (const f of files) {
  let job;
  try {
    job = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    console.log(`\n\x1b[31m✖ ${f}\x1b[0m\n  JSON hỏng: ${e.message}`);
    failed++;
    continue;
  }

  const r = validate(job, f);
  const name = path.basename(f);

  if (r.ok && !r.warns.length) {
    console.log(`\x1b[32m✔ ${name}\x1b[0m — sạch, render được`);
  } else if (r.ok) {
    console.log(`\x1b[33m▲ ${name}\x1b[0m — qua, có ${r.warns.length} cảnh báo`);
  } else {
    console.log(`\x1b[31m✖ ${name}\x1b[0m — ${r.errors.length} lỗi, KHÔNG render`);
    failed++;
  }

  for (const e of r.errors) console.log(`   \x1b[31mLỖI\x1b[0m  ${e.where}: ${e.msg}`);
  for (const w of r.warns) console.log(`   \x1b[33mnhắc\x1b[0m ${w.where}: ${w.msg}`);
}

process.exit(failed ? 1 : 0);
