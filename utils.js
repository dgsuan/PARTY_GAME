// Small shared helpers used by every game module.
// Kept dependency-free so any game file can import just what it needs.

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// MediaPipe landmarks are normalized [0,1] in *unmirrored* camera space.
// Our video/canvas is mirrored with CSS (scaleX(-1)) so it feels like a
// mirror. To make a landmark line up with what the player sees, flip x.
// `view` is the logical CSS-pixel size of the canvas (see main.js) — never
// canvas.width, which is in device pixels on HiDPI screens.
export function toCanvasPoint(landmark, view) {
  // The <video> is laid out with object-fit: cover, so unless the camera
  // frame happens to match the viewport's aspect ratio it is scaled up and
  // cropped. Stretching landmarks across the full canvas therefore puts the
  // cursor somewhere the player's hand is not. Reproduce cover's transform:
  // scale to fill, centre, crop the overflow — then mirror, because the
  // video is flipped in CSS so it reads like a mirror.
  const vw = view.videoWidth || 0;
  const vh = view.videoHeight || 0;
  if (vw <= 0 || vh <= 0) {
    return { x: (1 - landmark.x) * view.width, y: landmark.y * view.height };
  }
  const scale = Math.max(view.width / vw, view.height / vh);
  const drawnW = vw * scale;
  const drawnH = vh * scale;
  const offsetX = (view.width - drawnW) / 2;
  const offsetY = (view.height - drawnH) / 2;
  return {
    x: view.width - (offsetX + landmark.x * drawnW),
    y: offsetY + landmark.y * drawnH,
  };
}

// Landmarks are normalised per-axis (x by frame width, y by frame height),
// so the same physical distance is a smaller number horizontally on a wide
// frame. Any check that compares an x-distance against a y-distance must
// first put both in the same units — multiply x by the frame's aspect.
export function frameAspect(view) {
  const vw = view.videoWidth || 0;
  const vh = view.videoHeight || 0;
  return vw > 0 && vh > 0 ? vw / vh : 16 / 9;
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function pickRandom(arr, exclude) {
  if (arr.length === 1) return arr[0];
  let choice;
  do {
    choice = arr[Math.floor(Math.random() * arr.length)];
  } while (exclude !== undefined && choice === exclude);
  return choice;
}

// Centre of the palm (wrist + the four knuckle bases), in raw landmark
// space. Unlike a fingertip this stays put whether the hand is open or
// balled into a fist, so "hand becomes hammer" tracking doesn't fall apart
// the moment a player clenches to swing.
export function palmCenter(landmarks) {
  const idx = [0, 5, 9, 13, 17];
  let x = 0, y = 0;
  for (const i of idx) { x += landmarks[i].x; y += landmarks[i].y; }
  return { x: x / idx.length, y: y / idx.length };
}

// Cartoon hammer used as the "hands become hammers" cursor. `swing` (0-1)
// drives the wind-up so a strike reads as a strike.
export function drawHammer(ctx, x, y, color, swing = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.5 + swing * 0.9);
  ctx.fillStyle = "#6b4522";
  ctx.fillRect(-3.5, -6, 7, 44);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillRect(-21, -29, 42, 25);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(-21, -29, 42, 6);
  ctx.restore();
}

/* ── Juice: particles, floating score text, screen shake ───────────── */

export function createFx() {
  const bits = [];
  const texts = [];

  return {
    burst(x, y, color, count = 10, speed = 190) {
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const velocity = speed * (0.45 + Math.random() * 0.75);
        bits.push({
          x, y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          life: 0,
          max: 0.34 + Math.random() * 0.3,
          size: 1.6 + Math.random() * 2.4,
          color,
        });
      }
    },

    // Angular shards for shattering ice.
    shards(x, y, color, count = 8) {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = 90 + Math.random() * 190;
        bits.push({
          x, y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity - 40,
          life: 0,
          max: 0.4 + Math.random() * 0.35,
          size: 2 + Math.random() * 3.5,
          color,
          shard: true,
          spin: (Math.random() - 0.5) * 14,
          angle: Math.random() * Math.PI,
        });
      }
    },

    text(x, y, value, color) {
      texts.push({ x, y, value, color, life: 0, max: 0.7 });
    },

    update(dt) {
      for (const bit of bits) {
        bit.life += dt;
        bit.x += bit.vx * dt;
        bit.y += bit.vy * dt;
        bit.vy += 520 * dt;              // gravity
        bit.vx *= 0.98;
        if (bit.shard) bit.angle += bit.spin * dt;
      }
      for (const item of texts) {
        item.life += dt;
        item.y -= 46 * dt;
      }
      prune(bits);
      prune(texts);
    },

    draw(ctx) {
      // No shadowBlur on particles: Canvas2D blur is a per-draw-call CPU
      // convolution, and a burst puts a dozen of them on screen at once.
      for (const bit of bits) {
        const k = 1 - bit.life / bit.max;
        ctx.save();
        ctx.globalAlpha = Math.max(0, k);
        ctx.fillStyle = bit.color;
        if (bit.shard) {
          ctx.translate(bit.x, bit.y);
          ctx.rotate(bit.angle);
          ctx.fillRect(-bit.size, -bit.size * 0.5, bit.size * 2, bit.size);
        } else {
          ctx.beginPath();
          ctx.arc(bit.x, bit.y, bit.size * k + 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      for (const item of texts) {
        const k = 1 - item.life / item.max;
        ctx.save();
        ctx.globalAlpha = Math.max(0, k);
        ctx.font = `700 ${Math.round(17 + k * 5)}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = item.color;
        ctx.shadowColor = item.color;
        ctx.shadowBlur = 12;
        ctx.fillText(item.value, item.x, item.y);
        ctx.restore();
      }
    },

    clear() {
      bits.length = 0;
      texts.length = 0;
    },
  };
}

function prune(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].life >= list[i].max) list.splice(i, 1);
  }
}

export function createShake() {
  let amount = 0;
  return {
    add(value) { amount = Math.min(16, amount + value); },
    update(dt) { amount *= Math.exp(-7 * dt); if (amount < 0.05) amount = 0; },
    apply(ctx) {
      if (amount === 0) return false;
      ctx.save();
      ctx.translate((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      return true;
    },
  };
}
