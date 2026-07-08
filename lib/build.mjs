#!/usr/bin/env node
// Chọn template rồi ghép biến vào -> build/index.html
// Dùng: node lib/build.mjs <outDir>

import { readFile, writeFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG = JSON.parse(await readFile('config.json', 'utf8'));

// Thứ tự ưu tiên: override trong queue.json > tag trên Woo > ngưỡng giá.
export function pickTemplate(data, queueEntry = {}) {
  if (queueEntry.template && queueEntry.template !== 'auto') {
    return { name: queueEntry.template, reason: 'override trong queue.json' };
  }
  if (data.tags.includes('reel-premium')) return { name: 'premium', reason: 'tag reel-premium' };
  if (data.tags.includes('reel-hook')) return { name: 'hook', reason: 'tag reel-hook' };
  const t = CONFIG.premiumThreshold;
  return data.priceRaw >= t
    ? { name: 'premium', reason: `giá ${data.priceRaw} >= ngưỡng ${t}` }
    : { name: 'hook', reason: `giá ${data.priceRaw} < ngưỡng ${t}` };
}


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

  const { name, reason } = pickTemplate(data, entry);
  console.log(`template: ${name}  (${reason})`);

  const copy = entry.copy ?? {};
  const brand = deriveBrand(data.name);
  const hero = copy.hero ?? deriveHero(data.name) ?? brand;

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
    IMAGE: data.imageFile,
    HERO: hero,
    TAGLINE: copy.tagline ?? brand.toUpperCase(),
    PILL: copy.pill ?? (data.onSale ? autoHook.pill : `${brand} chính hãng`),
    PAIN: copy.pain ?? (data.onSale ? autoHook.pain : ''),
    HEADLINE: copy.headline ?? (data.onSale ? autoHook.headline : shortName(data.name, 40)),
    PUNCH: copy.punch ?? (data.onSale ? autoHook.punch : 'CÓ TẠI LUCAS.VN'),
    SPEC1_K: copy.spec1?.[0] ?? 'Thông số', SPEC1_V: copy.spec1?.[1] ?? hero,
    SPEC2_K: copy.spec2?.[0] ?? 'Bảo hành', SPEC2_V: copy.spec2?.[1] ?? '12 tháng',
    SPEC3_K: copy.spec3?.[0] ?? 'Tình trạng', SPEC3_V: copy.spec3?.[1] ?? 'Mới, nguyên seal',
    SPEC4_K: copy.spec4?.[0] ?? 'Giao hàng', SPEC4_V: copy.spec4?.[1] ?? 'Toàn quốc',
    COUPON: copy.coupon ?? CONFIG.defaultCoupon,
  };

  const tpl = await readFile(join('templates', `${name}.html`), 'utf8');
  const durations = { hook: 8, premium: 9 };
  let html = render(tpl, vars);

  // <audio> là công dân hạng nhất của hyperframes — không cần ffmpeg mux.
  // Chỉ chèn khi thật sự có file, nếu không src hỏng sẽ làm `validate` fail.
  const hasBgm = existsSync('assets/bgm.mp4');
  html = html.replace(
    '<!--AUDIO-->',
    hasBgm
      ? `<audio data-start="0" data-duration="${durations[name]}" data-track-index="1" data-volume="0.35" src="assets/bgm.mp4"></audio>`
      : ''
  );
  await writeFile(join(outDir, 'index.html'), html);

  await cp('assets/fonts', join(outDir, 'assets', 'fonts'), { recursive: true });
  if (hasBgm) {
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
