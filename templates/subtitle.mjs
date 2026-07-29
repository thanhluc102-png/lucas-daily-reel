/**
 * PHỤ ĐỀ KARAOKE — lớp phủ cho renderer.
 *
 * Đọc subtitle.cues do scripts/align.mjs sinh ra, dựng DOM và trả về hàm
 * seek(t) để renderer gọi ở mỗi frame.
 *
 * Dùng trong template GSAP/Puppeteer:
 *
 *   import { mountSubtitles } from './subtitle.mjs';
 *   const sub = mountSubtitles(document.body, job.subtitle.cues);
 *   // mỗi frame:
 *   sub.seek(currentTimeSec);
 *
 * Không phụ thuộc GSAP — chỉ DOM + CSS, nên render bằng gì cũng chạy.
 */

const CSS = `
.lcs-sub {
  position: absolute;
  left: 0; right: 0;
  bottom: 500px;              /* y ~1420 — hạ xuống dưới ảnh sản phẩm, vẫn trên vùng nút TikTok */
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 0 90px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms linear;
}
.lcs-sub.on { opacity: 1; }

.lcs-line {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0 16px;
  line-height: 1.18;
}

.lcs-w {
  font-family: var(--lcs-font, 'Inter', 'SF Pro Display', system-ui, sans-serif);
  font-weight: 800;
  font-size: 62px;
  letter-spacing: -0.5px;
  color: #FFFFFF;
  /* viền tối để đọc được trên mọi nền ảnh */
  text-shadow:
     0 3px 0 rgba(0,0,0,.55),
     0 0 18px rgba(0,0,0,.65),
     0 0 3px rgba(0,0,0,.9);
  transform: translateY(0) scale(1);
  transition: color 90ms linear, transform 120ms cubic-bezier(.34,1.56,.64,1);
  will-change: transform, color;
}

/* chữ đang được đọc tới */
.lcs-w.hit {
  color: var(--lcs-accent, #C9A227);
  transform: translateY(-4px) scale(1.06);
}

/* chữ đã đọc qua — giữ trắng, không làm mờ vì mờ khó đọc trên video nén */
.lcs-w.past { color: #FFFFFF; }
`;

/**
 * @param {HTMLElement} root  phần tử cha (thường là body hoặc khung 1080x1920)
 * @param {Array} cues        job.subtitle.cues
 * @param {Object} opts       { accent, font, mode }
 *   mode: 'word'  — tô sáng từng chữ (mặc định, giống video đang chạy tốt)
 *         'plain' — hiện cả cue, không tô sáng
 */
export function mountSubtitles(root, cues, opts = {}) {
  const accent = opts.accent || '#C9A227';
  const mode = opts.mode || 'word';

  if (!document.getElementById('lcs-sub-style')) {
    const st = document.createElement('style');
    st.id = 'lcs-sub-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const box = document.createElement('div');
  box.className = 'lcs-sub';
  box.style.setProperty('--lcs-accent', accent);
  if (opts.font) box.style.setProperty('--lcs-font', opts.font);
  root.appendChild(box);

  // Dựng sẵn DOM cho từng cue, giấu đi. Tạo DOM lúc chạy sẽ giật frame.
  const built = cues.map((cue) => {
    const el = document.createElement('div');
    el.style.display = 'none';
    el.style.width = '100%';

    let wi = 0;
    const spans = [];

    for (const line of cue.lines) {
      const ln = document.createElement('div');
      ln.className = 'lcs-line';
      for (const token of line.split(/\s+/)) {
        if (!token) continue;
        const sp = document.createElement('span');
        sp.className = 'lcs-w';
        sp.textContent = token;
        const w = cue.words[wi++];
        sp._start = w ? w.start : cue.start;
        sp._end = w ? w.end : cue.end;
        ln.appendChild(sp);
        spans.push(sp);
      }
      el.appendChild(ln);
    }

    box.appendChild(el);
    return { cue, el, spans };
  });

  let activeIdx = -1;

  function seek(t) {
    // tìm cue đang chạy — thêm 0.08s đệm hai đầu cho khỏi nháy
    let idx = -1;
    for (let i = 0; i < built.length; i++) {
      const c = built[i].cue;
      if (t >= c.start - 0.08 && t <= c.end + 0.22) {
        idx = i;
        break;
      }
    }

    if (idx !== activeIdx) {
      if (activeIdx >= 0) built[activeIdx].el.style.display = 'none';
      if (idx >= 0) built[idx].el.style.display = 'block';
      box.classList.toggle('on', idx >= 0);
      activeIdx = idx;
    }

    if (idx < 0 || mode !== 'word') return;

    for (const sp of built[idx].spans) {
      const hit = t >= sp._start && t <= sp._end;
      const past = t > sp._end;
      if (sp._hit !== hit) {
        sp.classList.toggle('hit', hit);
        sp._hit = hit;
      }
      if (sp._past !== past) {
        sp.classList.toggle('past', past);
        sp._past = past;
      }
    }
  }

  return { seek, el: box, destroy: () => box.remove() };
}
