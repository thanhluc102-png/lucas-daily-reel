#!/usr/bin/env python3
"""
Lấy mốc thời gian TỪNG CHỮ từ file giọng đọc.

    python3 scripts/whisper_words.py jobs/<id>/voice.mp3 jobs/<id>/words.json

Cài: pip install faster-whisper

Model large-v3 chính xác nhất với tiếng Việt nhưng chậm (~1-2 phút cho video 30s
trên CPU). Máy yếu thì đổi sang "medium" — sai số khoảng 50-100ms, chấp nhận được
cho phụ đề karaoke.
"""

import sys
import json
import os

try:
    from faster_whisper import WhisperModel
except ImportError:
    sys.exit("Chưa cài faster-whisper. Chạy: pip install faster-whisper")

if len(sys.argv) < 3:
    sys.exit("Dùng: python3 scripts/whisper_words.py <voice.mp3> <words.json> [--model medium]")

audio_path, out_path = sys.argv[1], sys.argv[2]

if not os.path.exists(audio_path):
    sys.exit(f"Không tìm thấy file: {audio_path}")

model_size = "large-v3"
if "--model" in sys.argv:
    model_size = sys.argv[sys.argv.index("--model") + 1]

print(f"Nạp model {model_size}...")
model = WhisperModel(model_size, device="cpu", compute_type="int8")

print("Đang nghe...")
segments, info = model.transcribe(
    audio_path,
    language="vi",
    word_timestamps=True,
    vad_filter=True,
    vad_parameters={"min_silence_duration_ms": 300},
)

words = []
for seg in segments:
    if not seg.words:
        continue
    for w in seg.words:
        token = w.word.strip()
        if not token:
            continue
        words.append({
            "w": token,
            "start": round(w.start, 3),
            "end": round(w.end, 3),
            "p": round(w.probability, 3),
        })

if not words:
    sys.exit("Không nghe ra chữ nào. Kiểm tra file audio có tiếng không.")

os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(words, f, ensure_ascii=False, indent=1)

dur = words[-1]["end"]
low = sum(1 for w in words if w["p"] < 0.5)

print(f"✔ {out_path}")
print(f"  {len(words)} chữ, {dur:.1f} giây")
if low:
    print(f"  ▲ {low} chữ nghe không rõ (p<0.5) — kiểm lại nếu phụ đề sai chính tả")
