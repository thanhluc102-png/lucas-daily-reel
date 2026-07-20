#!/usr/bin/env node
// Chọn sản phẩm để quay hôm nay. Ghi ra build/picked.json + cập nhật history.json.
// Chiến lược đặt trong config.json: onsale | newest | random | queue

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const CONFIG = JSON.parse(await readFile('config.json', 'utf8'));
const BASE = CONFIG.storeBase;
const HISTORY = 'history.json';

async function listProducts(query) {
  const res = await fetch(`${BASE}/products?${query}`, {
    headers: { 'User-Agent': 'lucas-daily-reel/1.0' },
  });
  if (!res.ok) throw new Error(`Store API ${res.status}`);
  return res.json();
}

async function loadHistory() {
  if (!existsSync(HISTORY)) return { used: [] };
  return JSON.parse(await readFile(HISTORY, 'utf8'));
}

function recentIds(history, days) {
  const cutoff = Date.now() - days * 86400_000;
  return new Set(
    history.used.filter((u) => new Date(u.at).getTime() > cutoff).map((u) => u.id)
  );
}

const STRATEGIES = {
  // Hàng đang giảm giá — reel có giá gạch, tỉ lệ bấm vào cao nhất.
  onsale: 'on_sale=true&per_page=50&orderby=date&order=desc',
  // Hàng mới về.
  newest: 'per_page=50&orderby=date&order=desc',
  // Bốc ngẫu nhiên trong 100 sản phẩm mới nhất.
  random: 'per_page=100&orderby=date&order=desc',
};

// Xen kẽ nhiều nguồn theo config.mixTiers. Mỗi phần tử là một nguồn:
//   "onsale" | "newest" | "category:<id>"  (vd "category:4678" = danh mục Ba lô)
// Mỗi nhịp xoay sang nguồn KẾ TIẾP (dựa vào src của bài đăng gần nhất trong history),
// nên dù cron chạy rời rạc vẫn luân phiên đều.
const tierQuery = (tier) =>
  tier.startsWith('category:')
    ? `category=${tier.slice(9)}&per_page=50&orderby=date&order=desc`
    : STRATEGIES[tier] ?? STRATEGIES.onsale;
const tierLabel = (tier) =>
  tier === 'onsale' ? 'đang giảm giá'
  : tier === 'newest' ? 'hàng mới về'
  : tier.startsWith('category:') ? `danh mục ${tier.slice(9)}`
  : tier;

async function pickMix(history, seen, excluded) {
  const tiers = CONFIG.mixTiers ?? ['newest', 'onsale'];
  const clean = (list) =>
    list.filter((p) => p.is_in_stock && !excluded.has(p.id) && p.images?.[0]?.src);

  const lists = {};
  for (const t of tiers) lists[t] = clean(await listProducts(tierQuery(t)));

  // Bắt đầu từ nguồn ngay sau nguồn của bài đăng gần nhất (không thấy -> nguồn đầu tiên).
  const startIdx = (tiers.indexOf(history.used?.[0]?.src) + 1) % tiers.length;
  const rotated = [...tiers.slice(startIdx), ...tiers.slice(0, startIdx)];

  for (const t of rotated) {
    const list = lists[t] ?? [];
    const fresh = list.filter((p) => !seen.has(p.id));
    // Còn sp chưa quay -> mới nhất; hết -> bốc ngẫu nhiên (tránh lặp cùng 1 sp).
    const chosen = fresh.length
      ? fresh[0]
      : list.length
        ? list[Math.floor(Math.random() * list.length)]
        : null;
    if (chosen) {
      return {
        id: chosen.id,
        name: chosen.name,
        src: t,
        reason: `mix -> ${tierLabel(t)} (${list.length} sp hợp lệ, ${fresh.length} chưa quay ${CONFIG.historyDays ?? 21} ngày)`,
      };
    }
  }
  throw new Error('Không còn sản phẩm nào hợp lệ (mix)');
}

export async function pickDaily() {
  const strategy = CONFIG.strategy ?? 'onsale';
  const history = await loadHistory();
  const seen = recentIds(history, CONFIG.historyDays ?? 21);
  const excluded = new Set(CONFIG.excludeIds ?? []);

  if (strategy === 'queue') {
    const q = JSON.parse(await readFile('queue.json', 'utf8'));
    return { id: q.items[0].id, reason: 'đầu queue.json' };
  }

  if (strategy === 'mix') return pickMix(history, seen, excluded);

  const query = STRATEGIES[strategy];
  if (!query) throw new Error(`Chiến lược không hợp lệ: ${strategy}`);

  let pool = await listProducts(query);
  const before = pool.length;
  pool = pool.filter((p) => p.is_in_stock && !excluded.has(p.id) && p.images?.[0]?.src);
  const afterStock = pool.length;
  const fresh = pool.filter((p) => !seen.has(p.id));

  // Nếu đã quay hết trong chu kỳ history thì cho phép lặp lại, đừng để trống ngày.
  const candidates = fresh.length ? fresh : pool;
  if (!candidates.length) throw new Error('Không còn sản phẩm nào hợp lệ');

  const chosen =
    !fresh.length
      ? pool[Math.floor(Math.random() * pool.length)] // hết hàng mới -> bốc ngẫu nhiên, tránh lặp lại cùng 1 sp
      : strategy === 'random'
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : candidates[0];

  const reason =
    `${strategy}: ${before} kết quả -> ${afterStock} còn hàng -> ` +
    `${fresh.length} chưa quay trong ${CONFIG.historyDays ?? 21} ngày` +
    (fresh.length ? '' : ' (đã hết mới, cho lặp lại)');

  return { id: chosen.id, name: chosen.name, reason };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const forced = process.argv[2];
  let picked;

  if (forced) {
    picked = { id: Number(forced), reason: 'ép bằng tay qua workflow_dispatch' };
  } else {
    picked = await pickDaily();
  }

  console.log(`chọn ${picked.id}${picked.name ? '  ' + picked.name : ''}`);
  console.log(`     ${picked.reason}`);

  await mkdir('build', { recursive: true });
  await writeFile('build/picked.json', JSON.stringify(picked, null, 2));

  const history = await loadHistory();
  history.used.unshift({ id: picked.id, at: new Date().toISOString(), src: picked.src });
  history.used = history.used.slice(0, 200);
  await writeFile(HISTORY, JSON.stringify(history, null, 2) + '\n');

  // Cho workflow đọc. appendFileSync, KHÔNG writeFile — nếu ghi đè sẽ xoá mất
  // các output bước trước đã ghi vào cùng file (ví dụ skip=... của guard).
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `id=${picked.id}\n`);
  }
}
