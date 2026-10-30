/**
 * PHỤ ĐỀ KINETIC TYPOGRAPHY (SHOTCRAFT EDITION) — lớp phủ cho renderer.
 *
 * Áp dụng 3 công thức chữ chạy từ Vincentwei1021/video-shotcraft (14.9k ⭐):
 * 1. BlurSlide (3 kênh đồng bộ opacity + translateY + blur trên cùng đường cong bezier EASE.out)
 * 2. MarkerUnderlineTitle (Nét cọ bút dạ SVG biến thiên độ dày quét ngang dưới từ khoá trong 8 frame)
 * 3. GradientWordSweep (Sóng ánh kim vàng Gold + hào quang đa tầng khi giọng đọc chạm tới từ khoá)
 */

// Bộ giải đường cong Cubic-Bezier chuẩn Newton-Raphson từ video-shotcraft/Polish.tsx
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
function bezier(x1, y1, x2, y2) {
  if (x1 === y1 && x2 === y2) return (t) => clamp01(t);
  const ax = 1 - 3 * x2 + 3 * x1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 1 - 3 * y2 + 3 * y1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  const solve = (x) => {
    let u = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(u) - x;
      if (Math.abs(err) < 1e-7) return u;
      const d = dx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    let lo = 0, hi = 1;
    u = x;
    for (let i = 0; i < 32; i++) {
      const v = sx(u);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return u;
  };
  return (t) => (t <= 0 ? 0 : t >= 1 ? 1 : sy(solve(t)));
}

const EASE_OUT = bezier(0.22, 1, 0.36, 1);       // quint-out: chữ nổi lên từ vùng mờ quang học
const EASE_SNAPPY = bezier(0.16, 1, 0.3, 1);     // expo-out: nét cọ quét dứt khoát
const EASE_OVERSHOOT = bezier(0.34, 1.45, 0.64, 1); // nảy nhẹ khi nhấn giọng

// Sinh đường path nét cọ bút dạ biến thiên độ dày (từ MarkerUnderlineTitle.tsx)
function buildMarkerPath(len = 200) {
  const N = 28;
  const top = [];
  const bot = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = t * len;
    const mid = 14 - t * 4.5 + Math.sin(t * Math.PI * 1.5 + 0.3) * 1.8;
    const wBase = 11 + Math.sin(t * Math.PI) * 5 - Math.max(0, t - 0.85) * 32 - Math.max(0, 0.06 - t) * 45;
    const w = Math.max(2.2, wBase);
    top.push(`${x.toFixed(1)},${(mid - w / 2).toFixed(1)}`);
    bot.push(`${x.toFixed(1)},${(mid + w / 2).toFixed(1)}`);
  }
  return `M${top.join('L')}L${bot.reverse().join('L')}Z`;
}
const MARKER_PATH = buildMarkerPath(200);

const CSS = `
.lcs-sub {
  position: absolute;
  left: 0; right: 0;
  bottom: 395px;              /* chuẩn vùng an toàn, dưới spec callouts & trên UI Reels/TikTok */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 54px;
  pointer-events: none;
  z-index: 45;
  opacity: 0;
}
.lcs-sub.on { opacity: 1; }

/* Sân khấu chữ mở kiểu tạp chí (không đóng khung hộp chữ nhật cứng) */
.lcs-cue-card {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 36px 26px;
  will-change: transform, opacity;
}
.lcs-cue-card::before {
  content: "";
  position: absolute;
  inset: -28px -56px;
  z-index: -1;
  background: radial-gradient(closest-side, rgba(6, 15, 28, 0.90) 0%, rgba(8, 20, 36, 0.62) 64%, rgba(8, 20, 36, 0) 100%);
  pointer-events: none;
}

.lcs-line {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: baseline;
  gap: 8px 16px;
  line-height: 1.18;
}

.lcs-w {
  position: relative;
  display: inline-block;
  font-family: var(--lcs-font, 'Inter', 'SF Pro Display', system-ui, sans-serif);
  font-weight: 800;
  font-size: 56px;
  letter-spacing: -1.2px;
  color: rgba(190, 206, 224, 0.85);
  padding: 0 3px;
  text-shadow:
    0 4px 18px rgba(0, 0, 0, 0.88),
    0 1px 3px rgba(0, 0, 0, 0.95);
  transform-origin: center 82%;
  will-change: transform, opacity, filter, color;
}

/* Phân cấp Typography: Từ khoá / Con số lớn hơn 18%, đậm 900 */
.lcs-w.kw {
  font-size: 66px;
  font-weight: 900;
  letter-spacing: -1.8px;
  color: #FFFFFF;
}

/* Chữ đang được đọc tới — Sáng trắng tinh khiết + Hào quang nhẹ */
.lcs-w.hit {
  color: #FFFFFF;
  text-shadow:
    0 0 26px rgba(255, 255, 255, 0.55),
    0 6px 20px rgba(0, 0, 0, 0.92);
}

/* Từ khoá khi đọc tới hoặc đã đọc qua — Gradient Vàng Ánh Kim + Nét cọ bút dạ phía dưới */
.lcs-w.kw.hit,
.lcs-w.kw.past {
  color: #FFE07D;
  text-shadow:
    0 0 28px rgba(201, 162, 39, 0.72),
    0 6px 22px rgba(0, 0, 0, 0.95);
}

/* Chữ thường đã đọc qua — Trắng rõ nét */
.lcs-w.past {
  color: #F4F7FB;
}

/* Nét cọ bút dạ SVG (MarkerUnderlineTitle) dưới chân từ khoá */
.lcs-marker {
  position: absolute;
  left: -4%;
  right: -4%;
  bottom: -10px;
  width: 108%;
  height: 22px;
  overflow: visible;
  pointer-events: none;
  z-index: -1;
  transform-origin: left center;
  transform: scaleX(0);
  filter: drop-shadow(0 4px 12px rgba(201, 162, 39, 0.55));
}
`;

// Nhận diện từ khoá quan trọng (con số, giá tiền, %, đơn vị kỹ thuật, thương hiệu, tính năng đắt giá)
function isKeyToken(token) {
  const clean = token.replace(/[.,!?;:"'“”‘’()\[\]…]/g, '');
  if (!clean) return false;
  if (/\d/.test(clean)) return true; // Mọi con số: 95, 100%, 66g, 500mAh, 649.000đ, 180...
  if (/^(CRI|USB-C|Type-C|MagSafe|Qi2|GaN|PD|LED|SGS|YKK|Lucas\.vn|Lucas|Ulanzi)$/i.test(clean)) return true;
  return false;
}

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

  const built = cues.map((cue) => {
    const el = document.createElement('div');
    el.className = 'lcs-cue-card';
    el.style.display = 'none';

    let wi = 0;
    const spans = [];

    for (const line of cue.lines) {
      const ln = document.createElement('div');
      ln.className = 'lcs-line';
      for (const token of line.split(/\s+/)) {
        if (!token) continue;
        const sp = document.createElement('span');
        const kw = isKeyToken(token);
        sp.className = kw ? 'lcs-w kw' : 'lcs-w';

        const txt = document.createElement('span');
        txt.textContent = token;
        sp.appendChild(txt);

        let markerSvg = null;
        if (kw) {
          markerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          markerSvg.setAttribute('viewBox', '0 0 200 24');
          markerSvg.setAttribute('preserveAspectRatio', 'none');
          markerSvg.setAttribute('class', 'lcs-marker');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', MARKER_PATH);
          path.setAttribute('fill', accent);
          markerSvg.appendChild(path);
          sp.appendChild(markerSvg);
        }

        const w = cue.words[wi];
        sp._idx = wi;
        sp._start = w ? w.start : cue.start;
        sp._end = w ? w.end : cue.end;
        sp._kw = kw;
        sp._marker = markerSvg;
        wi++;

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
    let idx = -1;
    for (let i = 0; i < built.length; i++) {
      const c = built[i].cue;
      if (t >= c.start - 0.10 && t <= c.end + 0.24) {
        idx = i;
        break;
      }
    }

    if (idx !== activeIdx) {
      if (activeIdx >= 0) built[activeIdx].el.style.display = 'none';
      if (idx >= 0) built[idx].el.style.display = 'inline-flex';
      box.classList.toggle('on', idx >= 0);
      activeIdx = idx;
    }

    if (idx < 0) return;

    const item = built[idx];
    const cueStart = item.cue.start;
    const cueDur = Math.max(0.4, item.cue.end - cueStart);
    // Đẩy nhẹ toàn cụm chữ 1.0 -> 1.025 trong suốt thời gian cue (như BlurSlide.tsx)
    const push = 1 + 0.025 * clamp01((t - cueStart) / cueDur);
    item.el.style.transform = `scale(${push.toFixed(4)})`;
    item.el.style.opacity = '1';

    if (mode !== 'word') return;

    const nWords = item.spans.length;
    // Khoảng cách stagger giữa các từ khi vào câu (4f @30fps = 0.12s, nén xuống nếu câu > 6 từ theo quy tắc BlurSlide)
    const staggerSec = nWords > 6 ? 0.065 : 0.095;

    for (const sp of item.spans) {
      // 1. Kênh BlurSlide: từng từ nổi lên từ vùng mờ quang học (opacity + translateY + blur dùng chung p)
      const wordEnterStart = ( cueStart - 0.08 ) + sp._idx * staggerSec;
      const enterP = EASE_OUT(clamp01((t - wordEnterStart) / 0.42));

      // 2. Kênh Karaoke / Trọng âm khi giọng đọc chạm tới từ
      const hit = t >= sp._start - 0.03 && t <= sp._end + 0.08;
      const past = t > sp._end + 0.08;
      if (sp._hit !== hit) {
        sp.classList.toggle('hit', hit);
        sp._hit = hit;
      }
      if (sp._past !== past) {
        sp.classList.toggle('past', past);
        sp._past = past;
      }

      const baseY = (1 - enterP) * 32;
      const blurPx = (1 - enterP) * 12;
      let sc = 1;
      let liftY = 0;

      if (hit) {
        const wDur = Math.max(0.14, sp._end - sp._start);
        const wp = EASE_OVERSHOOT(clamp01((t - sp._start) / Math.min(0.22, wDur)));
        sc = 1 + (sp._kw ? 0.16 : 0.08) * wp;
        liftY = (sp._kw ? -8 : -4) * wp;
      } else if (past && sp._kw) {
        sc = 1.05;
        liftY = -2;
      }

      const finalOp = Math.max(0.01, enterP * (hit || past ? 1 : 0.72));
      sp.style.opacity = finalOp.toFixed(3);
      sp.style.transform = `translateY(${(baseY + liftY).toFixed(1)}px) scale(${sc.toFixed(3)})`;
      sp.style.filter = blurPx > 0.15 ? `blur(${blurPx.toFixed(1)}px)` : 'none';

      // 3. Kênh MarkerUnderlineTitle: quét nét cọ bút dạ dưới từ khoá trong 0.26s (8 frames) khi đọc tới
      if (sp._marker) {
        const drawP = EASE_SNAPPY(clamp01((t - (sp._start - 0.02)) / 0.26));
        sp._marker.style.transform = `scaleX(${drawP.toFixed(3)})`;
      }
    }
  }

  return { seek, el: box, destroy: () => box.remove() };
}
