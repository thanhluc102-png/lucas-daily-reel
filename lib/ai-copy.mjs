#!/usr/bin/env node
// Sinh nội dung + màu accent RIÊNG cho từng sản phẩm bằng Claude (vision).
//
// Vì sao gọi REST bằng fetch thay vì SDK: cả repo (Woo Store API, Facebook Graph)
// đều dùng fetch, không có dependency ngoài hyperframes. Giữ đúng nếp đó.
//
// Nguyên tắc AN TOÀN: hàm này CÓ THỂ throw (thiếu key, mạng, lỗi model, JSON hỏng).
// build.mjs bắt lỗi và rơi về nội dung mặc định — bot không bao giờ vỡ vì AI.
//
// Cần secret ANTHROPIC_API_KEY. Đổi model qua env AI_MODEL. Tắt hẳn: AI_COPY=false.

import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';

// Bài học rút từ tương tác thực tế (scripts/optimize.mjs ghi ra). Nhồi vào prompt
// để mỗi lần viết lời reel lại tốt hơn dựa trên bài nào đã ăn khách.
function learningsBlock() {
  try {
    if (existsSync('learnings.txt')) {
      const t = readFileSync('learnings.txt', 'utf8').trim();
      if (t) return `\n\nHƯỚNG DẪN RÚT TỪ TƯƠNG TÁC THỰC TẾ GẦN ĐÂY (ưu tiên áp dụng):\n${t}\n`;
    }
  } catch { /* thiếu file cũng không sao */ }
  return '';
}
import { join, extname } from 'node:path';

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.AI_MODEL ?? 'claude-opus-4-8';

// output_config.format ép model trả đúng JSON này — không cần parse mò.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    layout: { type: 'string', enum: ['hook', 'premium'] },
    accent: { type: 'string', description: 'Mã màu hex #RRGGBB' },
    pill: { type: 'string' },
    headline: { type: 'string' },
    pain: { type: 'string' },
    punch: { type: 'string' },
    tagline: { type: 'string' },
    hero: { type: 'string' },
    spec1: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
    spec2: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
    spec3: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
    spec4: { type: 'object', additionalProperties: false, properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
    voiceover: { type: 'string' },
  },
  required: ['layout', 'accent', 'pill', 'headline', 'pain', 'punch', 'tagline', 'hero', 'spec1', 'spec2', 'spec3', 'spec4', 'voiceover'],
};

function buildPrompt(data) {
  return `Bạn là copywriter quảng cáo của lucas.vn (phụ kiện Apple/công nghệ chính hãng).
Viết nội dung cho MỘT video reel dọc quảng cáo sản phẩm dưới đây. Ảnh sản phẩm đính kèm.

Dữ liệu sản phẩm:
- Tên: ${data.name}
- Giá bán: ${data.price}${data.onSale ? ` (giá gốc ${data.regularPrice}, ĐANG GIẢM)` : ''}
- Mô tả: ${data.shortDescription || '(không có)'}
- Tags: ${(data.tags || []).join(', ') || '(không có)'}

Yêu cầu (TẤT CẢ bằng tiếng Việt, giọng bán hàng gọn, tự nhiên, KHÔNG sáo rỗng):
- layout: chọn "hook" nếu nên nhấn khuyến mãi/giá hời (đang giảm, hàng phổ thông); chọn "premium" nếu là món cao cấp nên nhấn chất lượng/thiết kế.
- accent: MỘT mã màu hex nổi bật LẤY TỪ MÀU THỰC của sản phẩm trong ảnh (màu vỏ/điểm nhấn). Nếu sản phẩm đen/trắng/xám thì chọn một màu hợp danh mục, tươi, dễ đọc trên nền tối. Tránh trắng, đen, xám nhạt.
- pill: nhãn ngắn (≤22 ký tự), ví dụ thương hiệu + điểm mạnh.
- headline: 2-4 từ mở đầu cảnh hook (nếu đang giảm có thể là "Giá cũ").
- pain: cụm ngắn sẽ bị gạch ngang (nếu đang giảm để giá gốc; nếu không thì nỗi đau/điểm yếu của giải pháp cũ).
- punch: câu chốt lớn, mạnh (≤26 ký tự), ví dụ "CÒN 449.000₫" hoặc lợi ích nổi bật.
- tagline: 1 cụm IN HOA ngắn cho cảnh sản phẩm (≤22 ký tự).
- hero: con số/điểm bán hàng anh hùng ngắn nhất có thể (ví dụ "170W", "MagSafe", "67g"). Dùng cho template premium.
- spec1..spec4: 4 cặp {key, value} thông số/cam kết thật, hợp sản phẩm (key ≤14 ký tự, value ≤18 ký tự). Ví dụ key "Bảo hành" value "12 tháng". Không bịa thông số kỹ thuật nếu không chắc — ưu tiên cam kết bán hàng (chính hãng, đổi trả, giao nhanh) khi thiếu dữ liệu.
- voiceover: LỜI ĐỌC cho giọng thuyết minh (đọc ~10-12 giây). 2-3 câu ngắn, TỐI ĐA 45 từ, giọng bán hàng hào hứng, tự nhiên như nói. Nêu tên/điểm mạnh sản phẩm + giá + chốt "Mua ngay tại lucas.vn". Viết như lời nói (đọc lên nghe xuôi), KHÔNG dùng ký hiệu/emoji, viết số tiền dạng đọc được (ví dụ "chỉ một triệu đồng").

Chỉ trả về JSON đúng schema, không thêm chữ nào khác.${learningsBlock()}`;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function generateCreative(data, outDir) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('thiếu ANTHROPIC_API_KEY');

  const imgFile = data.imageFiles?.[0] ?? data.imageFile;
  const imgPath = join(outDir, imgFile);
  const b64 = (await readFile(imgPath)).toString('base64');
  const media = extname(imgPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';

  const body = {
    model: MODEL,
    max_tokens: 1024,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
          { type: 'text', text: buildPrompt(data) },
        ],
      },
    ],
  };

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const json = await res.json();
  if (json.stop_reason === 'refusal') throw new Error('model từ chối trả lời');
  const text = json.content?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('không có text trong phản hồi');

  const c = JSON.parse(text); // output_config.format bảo đảm JSON hợp lệ
  if (!HEX.test(c.accent)) {
    console.warn(`[ai] accent "${c.accent}" không phải hex hợp lệ — build sẽ dùng màu mặc định`);
    c.accent = null;
  }
  return c;
}
