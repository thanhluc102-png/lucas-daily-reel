#!/usr/bin/env node
/**
 * Nối outro logo Lucas (mặt Lucy → logo, 3,6s, có tiếng) vào cuối một video dọc 1080x1920.
 *
 *   node scripts/outro.mjs jobs/<id>/final.mp4      → ghi đè final.mp4 bằng bản đã có outro
 *
 * render.mjs gọi appendOutro() sau bước trộn tiếng. Tắt cho một reel: "outro": false trong jobs/<id>.json.
 * Outro nằm ở assets/outro/lucas-outro.mp4 (nguồn dựng: Team Agent data/brand/lucy-avatar/).
 * Hình và tiếng của phần reel được cắt/đệm cho bằng đúng nhau trước khi nối, để outro không lệch tiếng.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUTRO = path.join(root, 'assets', 'outro', 'lucas-outro.mp4');

function probe(f) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', f], { encoding: 'utf8' }));
}
const videoDur = (p) => Number(p.streams.find((s) => s.codec_type === 'video')?.duration || p.format.duration);
function lufs(f) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/Integrated loudness:[\s\S]*?I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
  return m ? parseFloat(m[1]) : null;
}

/** Nối outro vào cuối mp4 (ghi đè). Trả về số giây outro đã nối, 0 nếu bỏ qua. */
export function appendOutro(mp4, { outro = OUTRO, fps = 30 } = {}) {
  if (!fs.existsSync(outro)) { console.log('  (không có assets/outro/lucas-outro.mp4, bỏ qua outro)'); return 0; }
  const p = probe(mp4), po = probe(outro);
  const d0 = videoDur(p), d1 = videoDur(po);
  const coTieng = p.streams.some((s) => s.codec_type === 'audio');
  // Outro (~-14 LUFS) to hơn reel (~-17/-18 LUFS): chỉnh tiếng outro cho bằng độ to của reel, tối đa giảm 8 dB / tăng 2 dB.
  const lReel = coTieng ? lufs(mp4) : null, lOutro = lufs(outro);
  const gain = lReel != null && lOutro != null ? Math.max(-8, Math.min(2, lReel - lOutro)) : -4;
  const args = ['-y', '-loglevel', 'error', '-i', mp4, '-i', outro];
  let a0 = '[0:a]';
  if (!coTieng) { args.push('-f', 'lavfi', '-t', d0.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'); a0 = '[2:a]'; }
  const v = (i) => `[${i}:v]fps=${fps},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,setpts=PTS-STARTPTS`;
  const a = (lab, d) => `${lab}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=0:${d.toFixed(3)},asetpts=N/SR/TB`;
  const fc = [
    `${v(0)}[v0]`, `${v(1)}[v1]`,
    `${a(a0, d0)}[a0]`, `${a('[1:a]', d1)},volume=${gain.toFixed(1)}dB[a1]`,
    '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
  ].join(';');
  const tmp = mp4.replace(/\.mp4$/, '') + '-outro.mp4';
  execFileSync('ffmpeg', [...args, '-filter_complex', fc, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', tmp], { stdio: 'inherit' });
  fs.renameSync(tmp, mp4);
  console.log(`  đã nối outro logo Lucas (+${d1.toFixed(1)}s, tiếng outro ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} dB cho bằng reel)`);
  return d1;
}

/** Số giây outro sẽ được nối (cho qc.mjs đối chiếu thời lượng). */
export function outroSec(job) {
  if (job?.outro === false || !fs.existsSync(OUTRO)) return 0;
  try { return videoDur(probe(OUTRO)); } catch { return 0; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const mp4 = process.argv[2];
  if (!mp4 || !fs.existsSync(mp4)) { console.error('Dùng: node scripts/outro.mjs jobs/<id>/final.mp4'); process.exit(2); }
  appendOutro(mp4);
}
