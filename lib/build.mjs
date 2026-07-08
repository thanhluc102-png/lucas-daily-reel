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
  const vars = {
    NAME: data.name,
    PRICE: data.price,
    REGULAR_PRICE: data.regularPrice,
    IMAGE: data.imageFile,
    PILL: copy.pill ?? 'Chính hãng tại Lucas',
    PAIN: copy.pain ?? '',
    HEADLINE: copy.headline ?? data.name,
    PUNCH: copy.punch ?? 'CÓ TẠI LUCAS.VN',
    SPEC1_K: copy.spec1?.[0] ?? 'Bảo hành', SPEC1_V: copy.spec1?.[1] ?? '12 tháng',
    SPEC2_K: copy.spec2?.[0] ?? 'Tình trạng', SPEC2_V: copy.spec2?.[1] ?? 'Mới, nguyên seal',
    SPEC3_K: copy.spec3?.[0] ?? 'Giao hàng', SPEC3_V: copy.spec3?.[1] ?? 'Toàn quốc',
    SPEC4_K: copy.spec4?.[0] ?? 'Hotline', SPEC4_V: copy.spec4?.[1] ?? '0902 391 348',
    COUPON: copy.coupon ?? CONFIG.defaultCoupon,
    // Nhạc: nếu chưa có file thì volume 0 để <audio> không làm render fail.
    BGM_VOLUME: existsSync(join(outDir, 'assets', 'bgm.mp4')) ? '0.35' : '0',
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
      ? `<audio id="bgm" data-start="0" data-duration="${durations[name]}" data-track-index="1" data-volume="0.35" src="assets/bgm.mp4"></audio>`
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
