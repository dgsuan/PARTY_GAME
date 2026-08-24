// Small shared helpers used by every game module.
// Kept dependency-free so any game file can import just what it needs.

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// MediaPipe landmarks are normalized [0,1] in *unmirrored* camera space.
// Our video/canvas is mirrored with CSS (scaleX(-1)) so it feels like a
// mirror. To make a landmark line up with what the player sees, flip x.
export function toCanvasPoint(landmark, canvas) {
  return {
    x: (1 - landmark.x) * canvas.width,
    y: landmark.y * canvas.height,
  };
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function drawHeart(ctx, x, y, size, filled) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  const s = size;
  ctx.moveTo(0, s * 0.3);
  ctx.bezierCurveTo(-s, -s * 0.6, -s * 1.6, s * 0.4, 0, s * 1.2);
  ctx.bezierCurveTo(s * 1.6, s * 0.4, s, -s * 0.6, 0, s * 0.3);
  ctx.closePath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#ff5fae";
  if (filled) {
    ctx.fillStyle = "#ff5fae";
    ctx.fill();
  }
  ctx.stroke();
  ctx.restore();
}

// Draws a simple cartoon hammer centered at (x, y), rotated slightly,
// used as the "hands become hammers" cursor in Ice Breaker.
export function drawHammer(ctx, x, y, color, angle = -0.5) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  // handle
  ctx.fillStyle = "#8a5a2b";
  ctx.fillRect(-4, -6, 8, 46);
  // head
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillRect(-22, -30, 44, 26);
  ctx.restore();
}

export function pickRandom(arr, exclude) {
  if (arr.length === 1) return arr[0];
  let choice;
  do {
    choice = arr[Math.floor(Math.random() * arr.length)];
  } while (exclude !== undefined && choice === exclude);
  return choice;
}

export function fmtTime(seconds) {
  const s = Math.max(0, seconds);
  return s.toFixed(1);
}
