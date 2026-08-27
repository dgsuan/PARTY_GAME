// Live micro-previews for the channel cards. Each is a tiny looping
// animation of the real game, drawn on a 50px-tall canvas — it tells you
// what a channel *is* faster than any blurb can.
// All four share one rAF loop that only runs while the menu is visible.

import { C } from "./theme.js";

const mounted = [];

// JS modulo keeps the sign, so `-1 % 4` is -1 and arr[-1] is undefined.
// Every time-derived index goes through here.
const wrap = (n, length) => {
  if (!Number.isFinite(n) || length <= 0) return 0;
  return ((Math.floor(n) % length) + length) % length;
};
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
  // Take the epoch from the first frame's own timestamp rather than from
  // performance.now(). They share a time origin but not an instant: a rAF
  // timestamp is the START of the frame, which can precede a
  // performance.now() call that just ran. That made `t` negative on the
  // first frame in Chrome (Windows/Android) while iOS Safari happened to
  // return a later value — and a negative t produced a negative array
  // index, because JS modulo keeps the sign.
  startedAt = 0;
  let last = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (startedAt === 0) startedAt = now;
    if (now - last < 45) return;          // ~22fps is plenty, and cheap
    last = now;
    const t = Math.max(0, (now - startedAt) / 1000);
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
    const active = wrap(t * 1.6, count);
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
    const index = wrap(t / 1.1, poses.length);
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
    const cleared = wrap(t * 2.4, total + 3);
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
  // Signal flicking between green and red while a marker climbs.
  freezeframe(ctx, w, h, t) {
    const red = (t % 3.2) > 1.9;
    ctx.save();
    ctx.fillStyle = red ? "rgba(255,77,77,0.16)" : "rgba(34,230,200,0.14)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = red ? C.danger : C.p1;
    ctx.lineWidth = 2;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 8;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    ctx.restore();
    const climb = red ? 0.55 : 0.25 + ((t % 3.2) / 1.9) * 0.35;
    for (const [x, col] of [[0.3, C.p1], [0.7, C.p2]]) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x * w, h * 0.86); ctx.lineTo(x * w, h * 0.16); ctx.stroke();
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 7;
      ctx.beginPath(); ctx.moveTo(x * w, h * 0.86);
      ctx.lineTo(x * w, h * 0.86 - (h * 0.7) * (x < 0.5 ? climb : climb * 0.75));
      ctx.stroke();
      ctx.restore();
    }
  },

  // A wall with a gap sweeping down past a figure.
  beamdodge(ctx, w, h, t) {
    const y = ((t * 0.55) % 1) * h;
    const gapX = w * (0.3 + 0.4 * Math.sin(t * 0.9));
    const gapW = w * 0.26;
    ctx.save();
    ctx.fillStyle = "rgba(255,77,77,0.6)";
    ctx.shadowColor = C.danger;
    ctx.shadowBlur = 8;
    ctx.fillRect(0, y - 3, Math.max(0, gapX - gapW / 2), 6);
    ctx.fillRect(gapX + gapW / 2, y - 3, Math.max(0, w - gapX - gapW / 2), 6);
    ctx.restore();
    stick(ctx, gapX, h * 0.72, h * 0.16, C.p1);
  },

  // A knot dragged back and forth along a rope.
  tugofwar(ctx, w, h, t) {
    const pull = Math.sin(t * 1.5) * 0.32;
    const knot = w * (0.5 + pull);
    ctx.save();
    ctx.strokeStyle = "rgba(190,170,130,0.85)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(w * 0.05, h / 2);
    ctx.quadraticCurveTo((w * 0.05 + knot) / 2, h / 2 + 5, knot, h / 2);
    ctx.quadraticCurveTo((w * 0.95 + knot) / 2, h / 2 + 5, w * 0.95, h / 2);
    ctx.stroke();
    const col = pull < 0 ? C.p1 : C.p2;
    ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(knot, h / 2, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    divider(ctx, w, h);
  },

  // Two figures locking in together, tumblers filling.
  vaultsync(ctx, w, h, t) {
    const cycle = t % 3;
    const synced = cycle > 1.4;
    const poses = [[-0.9, -0.9], [0, 0]];
    stick(ctx, w * 0.22, h * 0.66, h * 0.15, synced ? C.p1 : "rgba(255,255,255,0.6)", poses[0]);
    stick(ctx, w * 0.78, h * 0.66, h * 0.15, synced ? C.p1 : "rgba(255,255,255,0.6)", poses[1]);
    const r = h * 0.2;
    const progress = synced ? Math.min(1, (cycle - 1.4) / 1.2) : 0;
    ctx.save();
    ctx.translate(w / 2, h * 0.5);
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = C.amber; ctx.shadowColor = C.amber; ctx.shadowBlur = 10; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); ctx.stroke();
    ctx.restore();
  },

  // A sequence of poses flashing by, then pips filling in.
  echo(ctx, w, h, t) {
    const seq = [[-0.9, -0.9], [0, 0], [0.9, -0.9], [-1.6, -1.6]];
    const step = wrap(t * 1.6, seq.length + 1);
    if (step < seq.length && seq[step]) {
      stick(ctx, w / 2, h * 0.62, h * 0.19, C.amber, seq[step]);
    }
    const spacing = w * 0.09;
    const startX = w / 2 - (spacing * (seq.length - 1)) / 2;
    for (let i = 0; i < seq.length; i++) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(startX + i * spacing, h * 0.9, 3, 0, Math.PI * 2);
      ctx.fillStyle = i <= step ? C.amber : "rgba(255,255,255,0.2)";
      ctx.fill();
      ctx.restore();
    }
  },
};

function stick(ctx, cx, cy, s, color, arms) {
  const [la, ra] = Array.isArray(arms) ? arms : [-0.9, -0.9];
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 7;
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy - s * 1.6, s * 0.34, 0, Math.PI * 2);
  ctx.moveTo(cx, cy - s * 1.26); ctx.lineTo(cx, cy);
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx - Math.cos(la) * s, cy - s + Math.sin(la) * s);
  ctx.moveTo(cx, cy - s); ctx.lineTo(cx + Math.cos(ra) * s, cy - s + Math.sin(ra) * s);
  ctx.moveTo(cx, cy); ctx.lineTo(cx - s * 0.5, cy + s * 0.9);
  ctx.moveTo(cx, cy); ctx.lineTo(cx + s * 0.5, cy + s * 0.9);
  ctx.stroke();
  ctx.restore();
}

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
