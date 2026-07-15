#!/usr/bin/env node
// Sinh giọng đọc (voiceover) tiếng Việt bằng ElevenLabs TTS -> build/assets/voice.mp3.
//
// Cần secret ELEVENLABS_API_KEY. Đổi giọng/model qua env ELEVEN_VOICE_ID / ELEVEN_MODEL.
// Tắt giọng: VOICE=false.
//
// AN TOÀN: throw khi thiếu key / lỗi mạng / file hỏng. build.mjs bắt lỗi và render
// KHÔNG có giọng (vẫn còn nhạc nền) — bot không vỡ.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BASE = 'https://api.elevenlabs.io/v1/text-to-speech';
// eleven_v3: đọc tiếng Việt chuẩn thanh điệu (turbo/multilingual_v2 hay sai dấu, vd "sạc" -> "sác").
const MODEL = process.env.ELEVEN_MODEL ?? 'eleven_v3';
const VOICE = process.env.ELEVEN_VOICE_ID ?? 'ZsjEJaLQy3sgvwxicmDx';

export async function generateVoice(text, outDir) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('thiếu ELEVENLABS_API_KEY');
  const line = (text ?? '').trim();
  if (!line) throw new Error('không có lời đọc');

  const res = await fetch(`${BASE}/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: {
      'xi-api-key': key,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: line,
      model_id: MODEL,
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error(`mp3 nghi hỏng, chỉ ${buf.length} bytes`);

  const rel = 'assets/voice.mp3';
  await writeFile(join(outDir, rel), buf);
  return rel;
}
