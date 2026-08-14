#!/usr/bin/env node
/**
 * Lucas Combo – Telegram AI Command & Prompt Center
 * Trợ lý AI Telegram thông minh điều khiển sản xuất Reel, viết bài & tra cứu cho Lucas Combo.
 *
 * Chạy: node scripts/telegram-bot.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();
const envFile = path.join(root, '.env');

if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  }
}

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.KIOT_LC_TG_BOT;
const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.KIOT_LC_TG_CHAT;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!TG_TOKEN) {
  console.error('❌ Cần TELEGRAM_BOT_TOKEN trong file .env');
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;
const historyMap = new Map();

async function tgCall(method, body = {}) {
  const r = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function sendMsg(chatId, text, extra = {}) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...extra,
  });
}

async function sendVideo(chatId, videoPath, caption = '') {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('caption', caption.slice(0, 1000));
  formData.append('parse_mode', 'HTML');

  const fileBuffer = fs.readFileSync(videoPath);
  const blob = new Blob([fileBuffer], { type: 'video/mp4' });
  formData.append('video', blob, path.basename(videoPath));

  const r = await fetch(`${TG_API}/sendVideo`, {
    method: 'POST',
    body: formData,
  });
  return r.json();
}

async function askClaude(chatId, userPrompt, systemPrompt = '') {
  if (!ANTHROPIC_KEY) return '⚠️ Thiếu ANTHROPIC_API_KEY trong file .env để gọi AI.';

  let history = historyMap.get(chatId) || [];
  history.push({ role: 'user', content: userPrompt });
  if (history.length > 20) history = history.slice(-20);

  const brandContext = `Bạn là trợ lý AI quản lý sản phẩm & sản xuất Reel cho Lucas Combo (lucas.vn) - shop phụ kiện Apple / TP.HCM từ 2017.
Giọng thương hiệu: Thẳng, hiểu chuyện, không nổ. Tuyệt đối không dùng từ cấm: cực kỳ, siêu phẩm, đỉnh cao, xịn xò, nhanh tay kẻo hết.
Khi người dùng yêu cầu viết kịch bản, caption hoặc tư vấn sản phẩm, hãy tuân thủ quy tắc trên. ${systemPrompt}`;

  const body = {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1500,
    system: brandContext,
    messages: history,
  };

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    const reply = data.content?.find((b) => b.type === 'text')?.text || 'Không có phản hồi từ AI.';
    history.push({ role: 'assistant', content: reply });
    historyMap.set(chatId, history);
    return reply;
  } catch (err) {
    return `❌ Lỗi gọi Claude AI: ${err.message}`;
  }
}

async function handleReelCommand(chatId, argsText) {
  await sendMsg(chatId, '⏳ <b>AI đang khởi tạo kịch bản & tách nền Cutout video...</b>');
  try {
    let cmd = `node scripts/gen-scenes.mjs`;
    if (argsText) {
      cmd += ` ${argsText}`;
    }
    const genOut = execSync(cmd, { cwd: root, env: process.env, encoding: 'utf8' });
    const match = genOut.match(/(20\d{2}-\d{2}-\d{2}_[a-z0-9]{5})/);
    if (!match) throw new Error(`Không lấy được job_id: ${genOut.slice(0, 200)}`);
    
    const jobId = match[1];
    const jobJsonPath = path.join(root, 'jobs', `${jobId}.json`);

    await sendMsg(chatId, `🎬 <b>Đã tạo xong scenes.json [${jobId}]! Đang tách nền AI & Render MP4...</b>`);
    execSync(`node scripts/render.mjs ${jobJsonPath}`, { cwd: root, env: process.env, stdio: 'inherit' });

    const mp4Path = path.join(root, 'jobs', jobId, 'final.mp4');
    if (!fs.existsSync(mp4Path)) throw new Error('File final.mp4 không tồn tại sau khi render');

    const jobData = JSON.parse(fs.readFileSync(jobJsonPath, 'utf8'));
    const caption = `🎬 <b>REEL CUTOUT ĐÃ RENDER XONG!</b>\n\n📌 <b>Sản phẩm:</b> ${jobData.title_1}\n🔹 <b>Text 2:</b> ${jobData.title_2}\n🔹 <b>Text 3:</b> ${jobData.title_3}\n\n📝 <b>Caption gợi ý:</b>\n${jobData.caption || ''}`;

    await sendVideo(chatId, mp4Path, caption);
  } catch (err) {
    await sendMsg(chatId, `❌ <b>Lỗi tạo video:</b> ${err.message}`);
  }
}

async function processUpdate(u) {
  const msg = u.message;
  if (!msg || !msg.text) return;

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();

  if (ALLOWED_CHAT_ID && chatId !== String(ALLOWED_CHAT_ID)) {
    console.log(`Bỏ qua tin nhắn từ Chat ID lạ: ${chatId}`);
    return;
  }

  console.log(`[Telegram] (${chatId}) -> ${text}`);

  if (text.startsWith('/start') || text.startsWith('/help')) {
    const welcome = `<b>🤖 TRỢ LÝ AI ĐIỀU KHIỂN LUCAS COMBO</b>\n\n` +
      `Bạn có thể nhắn tin trực tiếp để Prompt cho AI hoặc dùng các lệnh nhanh:\n\n` +
      `🎬 <b>/reel [ID sản phẩm]</b> — Tạo & render video Cutout Reel mới và gửi file MP4 về đây.\n` +
      `👤 <b>/khach [SĐT]</b> — Tra cứu thành viên KiotViet (Platinum/Gold, tổng chi tiêu...)\n` +
      `🔍 <b>/tim [tên sản phẩm]</b> — Tra tồn kho & giá WooCommerce\n` +
      `📊 <b>/status</b> — Kiểm tra trạng thái hệ thống\n` +
      `💬 <b>Trò chuyện tự do</b> — Nhắn bất kỳ Prompt nào để AI hỗ trợ viết kịch bản, sửa caption, viết nội dung bài đăng Facebook!`;
    await sendMsg(chatId, welcome);
    return;
  }

  if (text.startsWith('/reel') || text.startsWith('/make')) {
    const args = text.replace(/^\/(reel|make)\s*/, '').trim();
    await handleReelCommand(chatId, args);
    return;
  }

  if (text.startsWith('/status')) {
    await sendMsg(chatId, `🟢 <b>Hệ thống đang hoạt động bình thường!</b>\n🕒 <b>Thời gian:</b> ${new Date().toLocaleString('vi-VN')}`);
    return;
  }

  // Trò chuyện / Prompt tự do với AI
  await tgCall('sendChatAction', { chat_id: chatId, action: 'typing' });
  const aiReply = await askClaude(chatId, text);
  await sendMsg(chatId, aiReply);
}

let offset = 0;
async function poll() {
  console.log(`🤖 Lucas AI Telegram Bot đang lắng nghe tin nhắn...`);
  while (true) {
    try {
      const res = await tgCall('getUpdates', { offset, timeout: 30 });
      if (res.ok && Array.isArray(res.result)) {
        for (const u of res.result) {
          offset = u.update_id + 1;
          await processUpdate(u);
        }
      }
    } catch (e) {
      console.error('Lỗi Polling Telegram:', e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

poll();
