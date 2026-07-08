// Caption cho reel + nội dung comment đầu tiên.
//
// Link mua nằm ở COMMENT, không nằm trong caption. Facebook hạ reach bài có
// link ra ngoài; đẩy link xuống comment đầu là cách né phổ biến.

import { readFile } from 'node:fs/promises';

const CONFIG = JSON.parse(await readFile('config.json', 'utf8'));

// Xoay vòng theo ngày trong năm, để caption không lặp y hệt mỗi lần.
function rotate(arr) {
  const start = new Date(new Date().getFullYear(), 0, 0);
  const day = Math.floor((Date.now() - start) / 86400_000);
  return arr[day % arr.length];
}

const OPENERS_SALE = [
  'Đang giảm giá tại Lucas.',
  'Giá tốt tuần này.',
  'Hạ giá, số lượng có hạn.',
];

const OPENERS_PLAIN = [
  'Hàng chính hãng, có sẵn tại Lucas.',
  'Vừa về kho Lucas.',
  'Có sẵn, giao toàn quốc.',
];

const CLOSERS = [
  'Link mua ở bình luận đầu tiên.',
  'Xem giá và đặt hàng ở bình luận bên dưới.',
  'Bấm bình luận đầu để đặt hàng.',
];

export function buildCaption(data) {
  const opener = rotate(data.onSale ? OPENERS_SALE : OPENERS_PLAIN);

  const priceLine = data.onSale
    ? `${data.price} — thay vì ${data.regularPrice}`
    : data.price;

  return [
    opener,
    '',
    data.name,
    priceLine,
    '',
    rotate(CLOSERS),
    '',
    CONFIG.hashtags,
  ].join('\n');
}

export function buildComment(data) {
  const lines = [
    `Đặt hàng: ${data.permalink}`,
    '',
    `Hotline / Zalo: ${CONFIG.hotline}`,
    CONFIG.address,
  ];
  if (data.onSale) {
    lines.splice(1, 0, `Giá hiện tại ${data.price}, giá gốc ${data.regularPrice}.`);
  }
  return lines.join('\n');
}
