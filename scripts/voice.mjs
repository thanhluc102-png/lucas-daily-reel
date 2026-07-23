#!/usr/bin/env node
/**
 * Tạo giọng đọc cho một job.
 *
 *   node scripts/voice.mjs jobs/2026-07-22_57586.json
 *
 * Cần trong .env:
 *   ELEVENLABS_API_KEY, EL_VOICE_SOUTH (hoặc EL_VOICE_NORTH)
 *
 * Đọc LIỀN cả kịch bản thành một file mp3 — không cắt từng cảnh.
 * Lý do: cắt từng cảnh thì ngữ điệu bị đứt, nghe như máy đọc rời rạc.
 * Thời lượng từng cảnh sẽ được đo lại ở bước align.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  console.error('Dùng: node scripts/voice.mjs jobs/<id>.json');
  process.exit(2);
}

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error('Thiếu ELEVENLABS_API_KEY. Thêm vào .env rồi chạy lại.');
  process.exit(2);
}

const job = JSON.parse(fs.readFileSync(file, 'utf8'));
const audio = job.audio || {};
const region = audio.region || 'mien_nam';

const voiceId =
  audio.voice_id ||
  (region === 'mien_nam' ? process.env.EL_VOICE_SOUTH : process.env.EL_VOICE_NORTH);

if (!voiceId) {
  console.error(`Thiếu voice id cho ${region}. Điền EL_VOICE_SOUTH / EL_VOICE_NORTH vào .env.`);
  process.exit(2);
}

// Ghép lời theo đúng thứ tự cảnh. Dấu chấm cuối mỗi cảnh để giọng nghỉ đúng chỗ.
const text = job.scenes
  .map((s) => s.text.trim().replace(/[.。]?$/, '.'))
  .join(' ');

const outDir = path.join(path.dirname(file), path.basename(file, '.json'));
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'voice.mp3');

console.log(`Giọng: ${voiceId} (${region})`);
console.log(`Số ký tự: ${text.length}`);

const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
  method: 'POST',
  headers: {
    'xi-api-key': KEY,
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg',
  },
  body: JSON.stringify({
    text,
    model_id: audio.model_id || 'eleven_multilingual_v2',
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.8,
      style: 0.35,
      use_speaker_boost: true,
    },
  }),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`ElevenLabs lỗi ${res.status}: ${body.slice(0, 400)}`);
  process.exit(1);
}

fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));

job.audio = { ...audio, voice_path: outFile, voice_provider: 'elevenlabs', region };
fs.writeFileSync(file, JSON.stringify(job, null, 2));

const kb = (fs.statSync(outFile).size / 1024).toFixed(0);
console.log(`\x1b[32m✔\x1b[0m ${outFile} (${kb} KB)`);
console.log('\nTiếp theo:');
console.log(`  python3 scripts/whisper_words.py ${outFile} ${path.join(outDir, 'words.json')}`);
console.log(`  node scripts/align.mjs ${file}`);
