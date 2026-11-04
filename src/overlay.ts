import type { FrameLandmarks, Pt } from './landmarks/types';

const HAND_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
// Shoulders and arms only; the hand model draws the hands.
const POSE_EDGES: [number, number][] = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16]];

const COLORS = { left: '#4fc3f7', right: '#ffb74d', pose: '#c5e1a5' };

/**
 * Draws landmarks on a canvas laid over the video. The canvas itself is never
 * CSS-mirrored; when the preview is mirrored we flip x while drawing, so labels
 * stay readable.
 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  lm: FrameLandmarks | null,
  mirrored: boolean,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (lm && (canvas.width !== lm.width || canvas.height !== lm.height)) {
    canvas.width = lm.width;
    canvas.height = lm.height;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!lm) return;
  const W = canvas.width;
  const H = canvas.height;
  const px = (p: Pt) => (mirrored ? 1 - p.x : p.x) * W;
  const py = (p: Pt) => p.y * H;
  const lw = Math.max(2, Math.round(W / 220));

  const line = (pts: Pt[], edges: [number, number][], color: string, minVis = 0) => {
    ctx.beginPath();
    for (const [a, b] of edges) {
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb) continue;
      if ((pa.v ?? 1) < minVis || (pb.v ?? 1) < minVis) continue;
      ctx.moveTo(px(pa), py(pa));
      ctx.lineTo(px(pb), py(pb));
    }
    // Dark outline first so lines stay visible on light or patterned clothing.
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = lw * 2.2;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.stroke();
  };
  const dots = (pts: Pt[], color: string) => {
    ctx.fillStyle = color;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(px(p), py(p), lw * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  if (lm.pose) line(lm.pose, POSE_EDGES, COLORS.pose, 0.3);
  for (const h of lm.hands) {
    const c = h.side === 'left' ? COLORS.left : COLORS.right;
    line(h.pts, HAND_EDGES, c);
    dots(h.pts, c);
    // Label at the wrist: L / R = the signer's anatomical hand, as assigned.
    const w = h.pts[0];
    ctx.font = `bold ${lw * 8}px system-ui, sans-serif`;
    ctx.fillStyle = c;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = lw;
    const label = h.side === 'left' ? 'L' : 'R';
    ctx.strokeText(label, px(w) + lw * 3, py(w) + lw * 8);
    ctx.fillText(label, px(w) + lw * 3, py(w) + lw * 8);
  }
}
