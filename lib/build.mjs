#!/usr/bin/env node
// Chọn template rồi ghép biến vào -> build/index.html
// Dùng: node lib/build.mjs <outDir>

import { readFile, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateCreative } from './ai-copy.mjs';
import { generateVoice } from './voice.mjs';

const CONFIG = JSON.parse(await readFile('config.json', 'utf8'));

// Thứ tự ưu tiên: override trong queue.json > tag trên Woo > AI chọn > ngưỡng giá.
export function pickTemplate(data, queueEntry = {}, ai = null) {
  if (queueEntry.template && queueEntry.template !== 'auto') {
    return { name: queueEntry.template, reason: 'override trong queue.json' };
  }
  if (data.tags.includes('reel-premium')) return { name: 'premium', reason: 'tag reel-premium' };
  if (data.tags.includes('reel-hook')) return { name: 'hook', reason: 'tag reel-hook' };
  if (ai?.layout === 'hook' || ai?.layout === 'premium') {
    return { name: ai.layout, reason: 'AI chọn' };
  }
  const t = CONFIG.premiumThreshold;
  return data.priceRaw >= t
    ? { name: 'premium', reason: `giá ${data.priceRaw} >= ngưỡng ${t}` }
    : { name: 'hook', reason: `giá ${data.priceRaw} < ngưỡng ${t}` };
}

// ---- Màu accent theo sản phẩm ----
const HEX = /^#[0-9a-fA-F]{6}$/;
const hexToRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (r, g, b) => '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
const lighten = (hex, amt) => { const [r, g, b] = hexToRgb(hex); return toHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt); };
// Chữ tối trên accent sáng, chữ trắng trên accent tối (đảm bảo đọc được với mọi màu).
const inkFor = (hex) => { const [r, g, b] = hexToRgb(hex); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? '#1a1204' : '#ffffff'; };


// ---- Suy ra nội dung khi sản phẩm không có `copy` viết tay ----

const BRANDS = ['PITAKA','Tomtoc','Anker','JCPAL','Innostyle','SATECHI','UNIQ',
                'LISEN','Thule','Aulumu','WiWU','Belkin','Baseus','Ugreen'];

// "170W", "9600mAh", "65W", "16 inch" -> con số anh hùng đặt giữa khung
function deriveHero(name) {
  const m = name.match(/(\d+(?:[.,]\d+)?)\s?(W|mAh|Wh|TB|GB)\b/i);
  if (m) return `${m[1]}${m[2].toUpperCase().replace('MAH','mAh')}`;
  return null;
}

function deriveBrand(name) {
  const hit = BRANDS.find((b) => new RegExp(`\\b${b}\\b`, 'i').test(name));
  return hit ?? 'LUCAS';
}

// Tên rất dài, cắt ở ranh giới từ để không tràn khung
function shortName(name, max = 34) {
  if (name.length <= max) return name;
  return name.slice(0, name.lastIndexOf(' ', max)) + '…';
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render(tpl, vars) {
  const out = tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`Template cần biến {{${k}}} nhưng không có trong data`);
    return escapeHtml(vars[k]);
  });
  const leftover = out.match(/\{\{\w+\}\}/);
  if (leftover) throw new Error(`Còn placeholder chưa thay: ${leftover[0]}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = process.argv[2] ?? 'build';
  const data = JSON.parse(await readFile(join(outDir, 'data.json'), 'utf8'));
  const queue = JSON.parse(await readFile('queue.json', 'utf8'));
  const entry = queue.items.find((i) => String(i.id) === String(data.id)) ?? {};

  // AI viết nội dung + màu riêng cho sản phẩm. Lỗi -> bỏ qua, dùng mặc định.
  let ai = null;
  if (process.env.AI_COPY !== 'false') {
    try {
      ai = await generateCreative(data, outDir);
      console.log(`ai: layout=${ai.layout}  accent=${ai.accent ?? '(mặc định)'}`);
    } catch (err) {
      console.warn(`[ai] bỏ qua, dùng nội dung mặc định: ${err.message}`);
    }
  }

  const { name, reason } = pickTemplate(data, entry, ai);
  console.log(`template: ${name}  (${reason})`);

  const copy = entry.copy ?? {};
  const brand = deriveBrand(data.name);
  const hero = copy.hero ?? ai?.hero ?? deriveHero(data.name) ?? brand;
  // spec: copy tay > AI > mặc định
  const aiSpec = (n) => (ai?.[`spec${n}`] ? [ai[`spec${n}`].key, ai[`spec${n}`].value] : null);
  // FORCE_ACCENT: đổi màu thủ công khi test/preview.
  const accentReq = process.env.FORCE_ACCENT ?? ai?.accent ?? '#FBBF24';
  const accent = HEX.test(accentReq) ? accentReq : '#FBBF24';

  // Không có copy viết tay + đang giảm giá -> gạch ngang chính là giá cũ.
  // Cơ chế strikethrough vốn dùng để phủ định "nỗi đau"; ở đây nỗi đau là giá cũ.
  const autoHook = {
    pill: `${brand} · đang giảm`,
    headline: 'Giá cũ',
    pain: data.regularPrice,
    punch: `CÒN ${data.price}`,
  };

  const vars = {
    NAME: shortName(data.name, 46),
    PRICE: data.price,
    REGULAR_PRICE: data.regularPrice,
    IMAGE1: data.imageFiles?.[0] ?? data.imageFile,
    IMAGE2: data.imageFiles?.[1] ?? data.imageFile,
    IMAGE3: data.imageFiles?.[2] ?? data.imageFile,
    HERO: hero,
    TAGLINE: copy.tagline ?? ai?.tagline ?? brand.toUpperCase(),
    PILL: copy.pill ?? ai?.pill ?? (data.onSale ? autoHook.pill : `${brand} chính hãng`),
    PAIN: copy.pain ?? ai?.pain ?? (data.onSale ? autoHook.pain : ''),
    HEADLINE: copy.headline ?? ai?.headline ?? (data.onSale ? autoHook.headline : shortName(data.name, 40)),
    PUNCH: copy.punch ?? ai?.punch ?? (data.onSale ? autoHook.punch : 'CÓ TẠI LUCAS.VN'),
    SPEC1_K: copy.spec1?.[0] ?? aiSpec(1)?.[0] ?? 'Thông số', SPEC1_V: copy.spec1?.[1] ?? aiSpec(1)?.[1] ?? hero,
    SPEC2_K: copy.spec2?.[0] ?? aiSpec(2)?.[0] ?? 'Bảo hành', SPEC2_V: copy.spec2?.[1] ?? aiSpec(2)?.[1] ?? '12 tháng',
    SPEC3_K: copy.spec3?.[0] ?? aiSpec(3)?.[0] ?? 'Tình trạng', SPEC3_V: copy.spec3?.[1] ?? aiSpec(3)?.[1] ?? 'Mới, nguyên seal',
    SPEC4_K: copy.spec4?.[0] ?? aiSpec(4)?.[0] ?? 'Giao hàng', SPEC4_V: copy.spec4?.[1] ?? aiSpec(4)?.[1] ?? 'Toàn quốc',
    COUPON: copy.coupon ?? CONFIG.defaultCoupon,
    ACCENT: accent,
    ACCENT_SOFT: lighten(accent, 0.42),
    ACCENT_INK: inkFor(accent),
  };

  const tpl = await readFile(join('templates', `${name}.html`), 'utf8');
  const durations = { hook: 14.769, premium: 16.0 };
  const total = durations[name];
  let html = render(tpl, vars);

  // Giọng đọc ElevenLabs. Lỗi -> bỏ qua, vẫn còn nhạc nền.
  let voiceFile = null;
  const voiceText = copy.voiceover ?? ai?.voiceover ?? null;
  if (voiceText) console.log(`lời đọc: "${voiceText}"`);
  // Chọn giọng: env ELEVEN_VOICE_ID (ghim cứng) > copy.voiceId (ghim theo sp) > random trong pool config.
  const pool = CONFIG.voices ?? [];
  const pick = process.env.ELEVEN_VOICE_ID
    ? { id: process.env.ELEVEN_VOICE_ID, name: 'ELEVEN_VOICE_ID' }
    : copy.voiceId
      ? { id: copy.voiceId, name: 'queue' }
      : pool.length
        ? pool[Math.floor(Math.random() * pool.length)]
        : null;
  if (process.env.VOICE !== 'false' && voiceText) {
    try {
      voiceFile = await generateVoice(voiceText, outDir, pick?.id);
      console.log(`voice: ${pick ? `${pick.name} — ${pick.id}` : 'mặc định'}`);
    } catch (err) {
      console.warn(`[voice] bỏ qua, render không giọng: ${err.message}`);
    }
  }

  // <audio> là công dân hạng nhất của hyperframes — không cần ffmpeg mux.
  // Có giọng thì hạ nhạc nền xuống để nghe rõ lời (ducking).
  const tracks = [];
  if (existsSync('assets/bgm.mp4')) {
    const musicVol = voiceFile ? 0.14 : 0.35;
    tracks.push(`<audio id="bgm" data-timeline-role="music" data-start="0" data-duration="${total}" data-track-index="1" data-volume="${musicVol}" src="assets/bgm.mp4"></audio>`);
  }
  if (voiceFile) {
    tracks.push(`<audio id="voice" data-timeline-role="voice" data-start="0.15" data-duration="${total}" data-track-index="2" data-volume="1" src="${voiceFile}"></audio>`);
  }
  html = html.replace('<!--AUDIO-->', tracks.join('\n      '));
  await writeFile(join(outDir, 'index.html'), html);

  await cp('assets/fonts', join(outDir, 'assets', 'fonts'), { recursive: true });
  if (existsSync('assets/bgm.mp4')) {
    await cp('assets/bgm.mp4', join(outDir, 'assets', 'bgm.mp4'));
    console.log('nhạc nền: assets/bgm.mp4');
  } else {
    console.log('nhạc nền: chưa có, render câm');
  }

  await writeFile(join(outDir, 'hyperframes.json'), JSON.stringify({
    $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
    registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
    paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
  }, null, 2));
  await writeFile(join(outDir, 'meta.json'), JSON.stringify({
    id: `reel-${data.id}`, name: data.name, createdAt: new Date().toISOString(),
  }, null, 2));

  await writeFile(join(outDir, 'chosen.json'), JSON.stringify({ template: name, reason }, null, 2));
}
