#!/usr/bin/env node
/**
 * TỰ SINH scenes.json cho một sản phẩm bằng Claude (thay cho việc viết tay).
 *
 *   node scripts/gen-scenes.mjs <product_id>   -> jobs/<job_id>.json  (in job_id ra stdout + GITHUB_OUTPUT)
 *
 * Claude chỉ viết phần SÁNG TẠO (text từng cảnh + vai + thời lượng + kiểu hook).
 * Code lắp phần cơ học (idx, sku_ref, asset, overlay, products, audio, cta) để
 * chắc chắn khớp schema. Sinh xong tự chạy validate.mjs, lỗi thì nhờ Claude sửa
 * lại tối đa 2 lần. Cần ANTHROPIC_API_KEY.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';
const API = 'https://api.anthropic.com/v1/messages';
const STORE = 'https://lucas.vn/wp-json/wc/store/v1';

const id = process.argv[2];
if (!id) { console.error('Dùng: node scripts/gen-scenes.mjs <product_id>'); process.exit(2); }
if (!KEY) { console.error('Thiếu ANTHROPIC_API_KEY'); process.exit(2); }

// Chọn sẵn giọng nữ ElevenLabs từ config.json để voice.mjs không cần EL_VOICE_SOUTH.
let voiceId = process.env.ELEVEN_VOICE_ID || null;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  if (!voiceId) voiceId = ((cfg.voices || []).find((v) => /n[ữu]/i.test(v.name)) || cfg.voices?.[0])?.id || null;
} catch { /* không có config cũng không sao */ }

// --- lấy sản phẩm thật -------------------------------------------------------
const res = await fetch(`${STORE}/products/${id}`, { headers: { 'User-Agent': 'lucas-daily-reel/1.0' } });
if (!res.ok) { console.error(`Store API ${res.status} cho sản phẩm ${id}`); process.exit(1); }
const p = await res.json();
const div = 10 ** Number(p.prices.currency_minor_unit || 0);
const price = Math.round(Number(p.prices.price) / div);
const regular = p.prices.regular_price ? Math.round(Number(p.prices.regular_price) / div) : null;
const onSale = !!p.on_sale && regular && regular > price;
const discount = onSale ? Math.round((1 - price / regular) * 100) : 0;
const priceIsFrom = p.type === 'variable'; // biến thể -> giá là giá THẤP NHẤT
const images = (p.images || []).map((i) => i.src).filter(Boolean);
if (!images.length) { console.error('Sản phẩm không có ảnh'); process.exit(1); }
const desc = (p.short_description || p.description || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);

const product = {
  sku: p.sku || `ID${p.id}`,
  name: p.name,
  price_vnd: price,
  regular_vnd: onSale ? regular : null,
  discount_pct: discount,
  price_is_from: priceIsFrom,
  url: p.permalink,
  image: images[0],
};

const editorial = (() => {
  try { return fs.readFileSync(path.join(root, 'rules', 'editorial.md'), 'utf8'); } catch { return ''; }
})();

const priceStr = price.toLocaleString('vi-VN').replace(/,/g, '.') + 'đ';       // 1.700.000đ
const regularStr = regular ? regular.toLocaleString('vi-VN').replace(/,/g, '.') + 'đ' : '';

// build/data.json để lib/post-reel.mjs dựng caption + comment (tái dùng lib/caption.mjs).
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'data.json'), JSON.stringify({
  name: product.name,
  price: (priceIsFrom ? 'chỉ từ ' : '') + priceStr,
  regularPrice: regularStr,
  onSale,
  permalink: product.url,
}, null, 2));

// --- schema cho phần sáng tạo Claude trả về ---------------------------------
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'format', 'scenes', 'price_scene_index', 'hook'],
  properties: {
    title: { type: 'string' },
    format: { enum: ['hook', 'premium', 'unbox', 'threads'] },
    scenes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['role', 'text', 'duration_sec'],
        properties: {
          role: { enum: ['hook', 'body', 'proof', 'price', 'cta'] },
          text: { type: 'string' },
          duration_sec: { type: 'number' },
        },
      },
    },
    price_scene_index: { type: 'integer' },
    price_label: { type: 'string' },
    hook: {
      type: 'object', additionalProperties: false, required: ['style'],
      properties: {
        style: { enum: ['stack', 'flash', 'slam', 'highlight'] },
        hero: { type: 'string' },
        hl: { type: 'array', items: { type: 'string' } },
        hlPhrase: { type: 'string' },
        lines: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

function buildPrompt(extraFix) {
  return `Bạn là copywriter reel quảng cáo của lucas.vn (phụ kiện Apple/công nghệ chính hãng, thương hiệu "Lucas Combo Plus", giọng thẳng, hiểu chuyện, KHÔNG nổ).

QUY TẮC BIÊN TẬP (tuân thủ tuyệt đối):
${editorial}

SẢN PHẨM (dữ liệu THẬT — không bịa thêm thông số):
- Tên: ${product.name}
- Giá bán: ${priceStr}${onSale ? ` (giá gốc ${regularStr}, đang giảm ${discount}%)` : ''}
- price_is_from: ${priceIsFrom} ${priceIsFrom ? '(BẮT BUỘC câu giá có "chỉ từ")' : ''}
- Mô tả chính hãng: ${desc || '(không có)'}

RÀNG BUỘC KỸ THUẬT (validator chặn cứng, sai là hỏng):
- 5–7 cảnh. Cảnh ĐẦU role "hook", cảnh CUỐI role "cta". ĐÚNG 1 hook và ĐÚNG 1 cta. Có ĐÚNG 1 cảnh "price".
- Mỗi cảnh: text 4–16 TỪ. Hook TỐI ĐA 12 từ và duration_sec ≤ 3.5.
- duration_sec mỗi cảnh: đủ để đọc = (số từ / 3.2) + 0.5 trở lên, và trong khoảng 2.0–5.0. Tổng 18–32 giây.
- Cảnh "price" đặt ở khoảng 60–70% (gần cuối, trước cta). price_scene_index = chỉ số (0-based) của cảnh price.
- Câu ở cảnh price PHẢI chứa đúng chuỗi giá "${priceStr}"${onSale ? ` và có thể nhắc "${discount}%"` : ''}${priceIsFrom ? ' và PHẢI có cụm "chỉ từ"' : ''}. KHÔNG viết số giá khác.
- price_label: ${onSale ? `"GIẢM ${discount}%"` : '"CHÍNH HÃNG"'}.
- Không dùng từ cấm (cực kỳ, siêu phẩm, đỉnh cao, số lượng có hạn, nhanh tay kẻo hết...). Không mở hook bằng "Xin chào", "Bạn có biết".

KINETIC HOOK — chọn "style" hợp câu hook:
- "slam": hook có CON SỐ/thông số mạnh -> đặt hero = con số đó (vd "170W"), pre = 1 dòng trước, post = 1 dòng sau.
- "highlight": hook nêu nỗi lo -> lines = 2-3 dòng ngắn tách ra, hlPhrase = cụm cần tô (phải nằm nguyên trong 1 dòng).
- "stack"/"flash": hook câu hỏi -> lines = 2-4 dòng ngắn tách ra, hl = 1-2 từ khoá cần tô gold.
Nội dung hook trong "hook" phải KHỚP với text của cảnh hook (cùng câu, chỉ tách dòng/tô chữ).
${extraFix ? `\nSỬA LỖI validator lần trước:\n${extraFix}\n` : ''}
Chỉ trả JSON đúng schema, không thêm gì khác.`;
}

async function askClaude(extraFix) {
  const body = {
    model: MODEL, max_tokens: 1500,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: buildPrompt(extraFix) }],
  };
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Anthropic HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = j.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('không có text trong phản hồi');
  return JSON.parse(text);
}

// --- lắp job hoàn chỉnh ------------------------------------------------------
function assemble(creative) {
  const jobId = new Date().toISOString().slice(0, 10) + '_' + Math.random().toString(36).slice(2, 7);
  const scenes = creative.scenes.map((s, i) => {
    const scene = {
      idx: i, role: s.role, text: s.text.trim(),
      duration_sec: Math.round(s.duration_sec * 10) / 10,
      sku_ref: product.sku,
      asset: { type: 'product_image', src: images[i % images.length], focus: 'center' },
    };
    if (i === creative.price_scene_index || s.role === 'price') {
      scene.overlay = { price_badge: true, label: (creative.price_label || (onSale ? `GIẢM ${discount}%` : 'CHÍNH HÃNG')).slice(0, 24) };
    }
    return scene;
  });
  return {
    version: 1, job_id: jobId, title: (creative.title || product.name).slice(0, 60),
    format: creative.format || 'hook', aspect: '9:16',
    brand: { bg: '#0B1B2E', accent: '#C9A227' },
    audio: { voice_provider: 'elevenlabs', gender: 'nu', region: 'mien_nam', speed: 1.05, bgm: 'auto', bpm: 195, ...(voiceId ? { voice_id: voiceId } : {}) },
    subtitle: { style: 'karaoke' },
    hook: creative.hook,
    products: [product],
    scenes,
    cta: { text: 'Lucas.vn — chính hãng, bảo hành đầy đủ', url: product.url },
  };
}

// --- vòng sinh + validate + sửa ---------------------------------------------
fs.mkdirSync(path.join(root, 'jobs'), { recursive: true });
let fix = '';
for (let attempt = 1; attempt <= 3; attempt++) {
  console.log(`[gen] lần ${attempt}: hỏi Claude…`);
  const creative = await askClaude(fix);
  const job = assemble(creative);
  const file = path.join(root, 'jobs', `${job.job_id}.json`);
  fs.writeFileSync(file, JSON.stringify(job, null, 2));
  try {
    execFileSync('node', [path.join(root, 'scripts', 'validate.mjs'), file], { stdio: 'pipe', encoding: 'utf8' });
    console.log(`[gen] ✔ hợp lệ: ${path.relative(root, file)}`);
    console.log(job.job_id);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `job=${job.job_id}\nfile=jobs/${job.job_id}.json\n`);
    process.exit(0);
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    fix = out.split('\n').filter((l) => /LỖI|ERROR/.test(l)).join('\n') || out.slice(0, 500);
    console.warn(`[gen] validator báo lỗi, thử lại:\n${fix}`);
    fs.rmSync(file, { force: true });
  }
}
console.error('[gen] Không tạo được scenes.json hợp lệ sau 3 lần.');
process.exit(1);
