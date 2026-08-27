// Live micro-previews for the channel cards. Each is a tiny looping
// animation of the real game, drawn on a 50px-tall canvas — it tells you
// what a channel *is* faster than any blurb can.
// All four share one rAF loop that only runs while the menu is visible.

import { C } from "./theme.js";

const mounted = [];
let raf = null;
let startedAt = 0;
let activeGroup = "menu";

// Previews belong to a group ("menu" cards, or the single "brief" demo) so
// only the visible group is animated.
export function mountPreview(canvas, id, group = "menu") {
  const ctx = canvas.getContext("2d");
  const entry = { canvas, ctx, id, group, w: 0, h: 0 };
  mounted.push(entry);
  measure(entry);
  return entry;
}

function measure(entry) {
  const rect = entry.canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  entry.w = Math.max(1, Math.round(rect.width));
  entry.h = Math.max(1, Math.round(rect.height));
  entry.canvas.width = Math.round(entry.w * dpr);
  entry.canvas.height = Math.round(entry.h * dpr);
  entry.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function measurePreviews() {
  for (const entry of mounted) measure(entry);
}

export function startPreviews(group = "menu") {
  activeGroup = group;
  if (raf !== null) return;
  startedAt = performance.now();
  let last = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (now - last < 45) return;          // ~22fps is plenty, and cheap
    last = now;
    const t = (now - startedAt) / 1000;
    for (const entry of mounted) {
      if (entry.group !== activeGroup) continue;
      if (entry.w === 0) measure(entry);
      entry.ctx.clearRect(0, 0, entry.w, entry.h);
      (RENDERERS[entry.id] || (() => {}))(entry.ctx, entry.w, entry.h, t);
    }
  };
  raf = requestAnimationFrame(loop);
}

export function stopPreviews() {
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
}

/* ── Per-game renderers ─────────────────────────────────────────── */

const RENDERERS = {
  // Bubbles drift up; one bomb among them.
  signalpop(ctx, w, h, t) {
    const items = [
      { x: 0.18, r: 6, speed: 0.42, phase: 0.0, kind: "s" },
      { x: 0.38, r: 4.5, speed: 0.55, phase: 0.35, kind: "a" },
      { x: 0.58, r: 7, speed: 0.36, phase: 0.7, kind: "s" },
      { x: 0.79, r: 5.5, speed: 0.48, phase: 0.15, kind: "b" },
    ];
    for (const item of items) {
      const p = ((t * item.speed + item.phase) % 1);
      const y = h + 8 - p * (h + 16);
      const color = item.kind === "b" ? C.danger : item.kind === "a" ? C.amber : C.p1;
      ctx.save();
      ctx.globalAlpha = Math.min(1, p * 4, (1 - p) * 4);
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(item.x * w, y, item.r, 0, Math.PI * 2);
      ctx.stroke();
      if (item.kind === "b") {
        const s = item.r * 0.45;
        ctx.beginPath();
        ctx.moveTo(item.x * w - s, y - s); ctx.lineTo(item.x * w + s, y + s);
        ctx.moveTo(item.x * w + s, y - s); ctx.lineTo(item.x * w - s, y + s);
        ctx.stroke();
      }
      ctx.restore();
    }
    divider(ctx, w, h);
  },

  // Moles pop out of a row of holes in sequence.
  whackamole(ctx, w, h, t) {
    const count = 4;
    const active = Math.floor(t * 1.6) % count;
    const phase = (t * 1.6) % 1;
    for (let i = 0; i < count; i++) {
      const cx = w * ((i + 0.5) / count);
      const cy = h * 0.72;
      const r = Math.min(w / count, h) * 0.26;
      if (i === active) {
        const rise = Math.sin(Math.min(1, phase * 1.4) * Math.PI) * r * 1.1;
        ctx.save();
        ctx.fillStyle = "#b98a4e";
        ctx.shadowColor = C.amber;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, cy - rise, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    divider(ctx, w, h);
  },

  // A stick figure cycling through the four target poses.
  copypose(ctx, w, h, t) {
    const poses = [[-0.9, -0.9], [0, 0], [0.9, -0.9], [-1.6, -1.6]];
    const index = Math.floor(t / 1.1) % poses.length;
    const [la, ra] = poses[index];
    const s = h * 0.2;
    const cx = w / 2;
    const cy = h * 0.72;
    const hit = (t / 1.1) % 1 > 0.55;
    ctx.save();
    ctx.strokeStyle = hit ? C.p1 : "rgba(255,255,255,0.75)";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy - s * 1.65, s * 0.36, 0, Math.PI * 2);
    ctx.moveTo(cx, cy - s * 1.28);
    ctx.lineTo(cx, cy);
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx - Math.cos(la) * s, cy - s + Math.sin(la) * s);
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + Math.cos(ra) * s, cy - s + Math.sin(ra) * s);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - s * 0.5, cy + s * 0.9);
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + s * 0.5, cy + s * 0.9);
    ctx.stroke();
    ctx.restore();
  },

  // A wall of ice clearing block by block, then resetting.
  icebreaker(ctx, w, h, t) {
    const cols = 6;
    const rows = 2;
    const total = cols * rows;
    const cleared = Math.floor((t * 2.4) % (total + 3));
    const padX = 3;
    const padY = 3;
    const bw = (w - padX * (cols + 1)) / cols;
    const bh = (h - padY * (rows + 1)) / rows;
    for (let i = 0; i < total; i++) {
      if (i < cleared) continue;
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = padX + c * (bw + padX);
      const y = padY + r * (bh + padY);
      ctx.save();
      ctx.fillStyle = "rgba(127, 216, 255, 0.16)";
      ctx.strokeStyle = "rgba(127, 216, 255, 0.75)";
      ctx.lineWidth = 1;
      ctx.shadowColor = C.ice;
      ctx.shadowBlur = 5;
      ctx.fillRect(x, y, bw, bh);
      ctx.strokeRect(x, y, bw, bh);
      ctx.restore();
    }
    divider(ctx, w, h);
  },
  // Water rising behind two leaks; one gets plugged, the level drops.
  hullbreach(ctx, w, h, t) {
    const cycle = t % 4;
    const level = cycle < 2.6 ? 0.18 + cycle * 0.16 : 0.6 - (cycle - 2.6) * 0.3;
    const waterY = h * (1 - Math.max(0.08, level));

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, waterY);
    for (let x = 0; x <= w; x += 6) {
      ctx.lineTo(x, waterY + Math.sin(x * 0.09 + t * 3) * 1.8);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(127, 216, 255, 0.34)";
    ctx.fill();
    ctx.strokeStyle = "rgba(200, 240, 255, 0.8)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    const leaks = [[0.3, 0.34], [0.7, 0.26]];
    leaks.forEach(([fx, fy], i) => {
      const plugged = i === 0 && cycle > 2.6;
      ctx.save();
      ctx.beginPath();
      ctx.arc(fx * w, fy * h, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(4,10,18,0.9)";
      ctx.fill();
      ctx.strokeStyle = plugged ? C.p1 : C.danger;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 7;
      ctx.stroke();
      if (!plugged) {
        ctx.strokeStyle = "rgba(200,240,255,0.6)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(fx * w, fy * h);
        ctx.lineTo(fx * w, fy * h - 9 - Math.sin(t * 8 + i) * 3);
        ctx.stroke();
      }
      ctx.restore();
    });
  },
};

function divider(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.setLineDash([3, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.restore();
}
