#!/usr/bin/env node
// Kéo dữ liệu 1 sản phẩm từ WooCommerce Store API.
// Store API là public read-only — KHÔNG cần consumer key/secret.
// Dùng: node lib/fetch-product.mjs <productId> <outDir>

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = process.env.STORE_BASE ?? 'https://lucas.vn/wp-json/wc/store/v1';

const stripHtml = (s = '') =>
  s.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

const vnd = (minorUnits, exp) => {
  const n = Number(minorUnits) / 10 ** Number(exp || 0);
  return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + '\u20ab';
};

export async function fetchProduct(id) {
  const res = await fetch(`${BASE}/products/${id}`, {
    headers: { 'User-Agent': 'lucas-daily-reel/1.0' },
  });
  if (!res.ok) throw new Error(`Store API ${res.status} cho product ${id}`);
  const p = await res.json();

  if (!p.is_in_stock) {
    console.warn(`[warn] ${id} hết hàng — vẫn dựng, nhưng cân nhắc bỏ qua`);
  }

  const exp = p.prices.currency_minor_unit;
  const regular = Number(p.prices.regular_price);
  const sale = Number(p.prices.price);
  const image = p.images?.[0];
  if (!image?.src) throw new Error(`Product ${id} không có ảnh đại diện`);

  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    permalink: p.permalink,
    inStock: p.is_in_stock,
    priceRaw: sale,                        // số nguyên, dùng để so ngưỡng
    price: vnd(sale, exp),
    regularPrice: vnd(regular, exp),
    onSale: regular > sale,
    // src = bản gốc 900x900. KHÔNG dùng field `thumbnail` (300x300, kéo lên sẽ vỡ).
    imageUrl: image.src,
    imageUrls: p.images.slice(0, 3).map((i) => i.src),
    tags: (p.tags ?? []).map((t) => t.slug),
    shortDescription: stripHtml(p.short_description),
  };
}

async function downloadImage(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tải ảnh thất bại: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 5000) throw new Error(`Ảnh nghi hỏng, chỉ ${buf.length} bytes`);
  await writeFile(dest, buf);
  return buf.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [id, outDir = 'build'] = process.argv.slice(2);
  if (!id) {
    console.error('Thiếu productId. Dùng: node lib/fetch-product.mjs 57586 build');
    process.exit(1);
  }
  const data = await fetchProduct(id);
  await mkdir(join(outDir, 'assets'), { recursive: true });

  // Tải tối đa 3 ảnh cho các cảnh gallery. Sản phẩm ít ảnh thì lặp lại ảnh cuối.
  data.imageFiles = [];
  let bytes = 0;
  for (let i = 0; i < 3; i++) {
    const url = data.imageUrls[i] ?? data.imageUrls.at(-1);
    const file = `assets/product-${i + 1}.png`;
    bytes += await downloadImage(url, join(outDir, file));
    data.imageFiles.push(file);
  }
  data.imageFile = data.imageFiles[0];
  await writeFile(join(outDir, 'data.json'), JSON.stringify(data, null, 2));
  console.log(`ok  ${data.name}`);
  console.log(`    ${data.price}  (raw ${data.priceRaw})  tags=[${data.tags}]`);
  console.log(`    ${data.imageFiles.length} ảnh, ${(bytes / 1024).toFixed(0)} KB tổng`);
}
