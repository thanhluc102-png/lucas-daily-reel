#!/usr/bin/env node
/**
 * Dùng Claude phân tích tương tác các reel đã đăng -> learnings.txt.
 * learnings.txt được lib/ai-copy.mjs nhồi lại vào prompt khi viết lời reel sau.
 * Cần ANTHROPIC_API_KEY. Chạy sau scripts/sync-insights.mjs.
 */
import { readFile, writeFile, access } from 'node:fs/promises';

const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';
const API = 'https://api.anthropic.com/v1/messages';
const HIST = 'reels_history.json';
const LEARN = 'learnings.txt';

const DEFAULT = [
  '- Hook 3 giây đầu nêu nỗi lo cụ thể của người dùng, chưa vội khoe sản phẩm.',
  '- Số cụ thể thắng tính từ (vd "rơi 2 mét không sao" hơn "chống sốc tốt").',
  '- Luôn có giá + CTA "lucas.vn". Không nổ, không "siêu phẩm/đỉnh cao".',
].join('\n');

async function main() {
  if (!KEY) { console.log('Thiếu ANTHROPIC_API_KEY — bỏ qua optimize.'); return; }
  let history = [];
  try { history = JSON.parse(await readFile(HIST, 'utf8')); } catch { /* chưa có */ }

  const scored = history.filter((r) => r.performance);
  if (scored.length === 0) {
    // Không ghi đè learnings đã tích luỹ chỉ vì tạm thời chưa có dữ liệu mới.
    try { await access(LEARN); console.log('Chưa có dữ liệu tương tác — giữ nguyên learnings.txt.'); }
    catch { await writeFile(LEARN, DEFAULT, 'utf8'); console.log('Chưa có dữ liệu — ghi hướng dẫn mặc định.'); }
    return;
  }

  const rows = scored.slice(-20).map((r) => {
    const p = r.performance;
    return `Sản phẩm: ${r.product_name || '(?)'}\nHook: ${r.hook || '(?)'}\nTương tác: Reactions=${p.reactions}, Comments=${p.comments}, Shares=${p.shares} (Score=${p.score})`;
  }).join('\n\n');

  const prompt = `Dưới đây là thống kê tương tác THỰC TẾ từ fanpage Lucas Combo Plus cho các video reel quảng cáo phụ kiện.
Score = Reactions*1 + Comments*3 + Shares*5 (Share nặng nhất vì khó đạt nhất).

DỮ LIỆU:
${rows}

Nhiệm vụ: phân tích và đúc kết thành bộ hướng dẫn viết lời reel tiếp theo.
- Chỉ ra kiểu hook / sản phẩm / cách viết nào cho tương tác cao nhất, kiểu nào kém nên tránh.
- Trình bày 5-8 gạch đầu dòng, tiếng Việt có dấu, cực ngắn gọn, để nhồi thẳng vào prompt hệ thống.
- Chỉ in gạch đầu dòng, không mở đầu/kết luận thừa.`;

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) { console.error(`Claude HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); return; }
    const j = await res.json();
    const learnings = (j.content?.[0]?.text || '').trim();
    if (!learnings) { console.error('Claude trả rỗng — giữ nguyên learnings.txt.'); return; }
    await writeFile(LEARN, learnings, 'utf8');
    console.log('Đã cập nhật learnings.txt:\n' + learnings);
  } catch (e) {
    console.error('Lỗi gọi Claude:', e.message);
  }
}
main().catch((e) => { console.error(e); process.exit(0); });
