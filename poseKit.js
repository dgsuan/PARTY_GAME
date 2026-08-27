import { toCanvasPoint, clamp, lerp, frameAspect } from "./utils.js";

/* ═══════════════════════════════════════════════════════════════════
   Shared body-tracking logic for the pose channels.

   Extracted from Copy the Pose once a second, third and fourth channel
   needed the same three hard-won pieces: scale-normalised measurement,
   aspect correction, and stable player identity.
   ═══════════════════════════════════════════════════════════════════ */

export const IDX = { nose: 0, ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24 };

export const BONES = [
  ["ls", "rs"], ["ls", "lh"], ["rs", "rh"], ["lh", "rh"],
  ["ls", "le"], ["le", "lw"], ["rs", "re"], ["re", "rw"],
];

const MIN_VISIBILITY = 0.5;

/* Landmarks are normalised to the *frame*, so a player standing further
   away produces smaller deltas for the same gesture. One body unit ≈ the
   player's torso, so a measurement means the same at any distance. */
export function bodyUnit(p) {
  const shoulderMid = { x: (p.ls.x + p.rs.x) / 2, y: (p.ls.y + p.rs.y) / 2 };
  const hipMid = { x: (p.lh.x + p.rh.x) / 2, y: (p.lh.y + p.rh.y) / 2 };
  const torso = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);
  const shoulders = Math.hypot(p.ls.x - p.rs.x, p.ls.y - p.rs.y);
  return Math.max(0.06, torso, shoulders * 0.85);
}

export const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* x is normalised by frame width and y by frame height, so on a 16:9
   camera the same physical distance reads ~44% smaller horizontally.
   Any check comparing an x-distance to a y-distance must correct first. */
export function getPoints(landmarks, view) {
  if (!landmarks) return null;
  const aspect = frameAspect(view);
  const points = {};
  for (const [name, index] of Object.entries(IDX)) {
    const landmark = landmarks[index];
    if (!landmark) return null;
    points[name] = { x: landmark.x * aspect, y: landmark.y };
  }
  return points;
}

// A pose is only usable if the landmarks the checks depend on are visible;
// a half-occluded player otherwise produces confident nonsense.
export function isUsable(pose) {
  for (const index of [IDX.ls, IDX.rs, IDX.lh, IDX.rh]) {
    const landmark = pose[index];
    if (!landmark) return false;
    if (landmark.visibility !== undefined && landmark.visibility < MIN_VISIBILITY) return false;
  }
  return true;
}

// Mirrored screen-space centre of a pose, 0 (left) to 1 (right).
export function poseCenter(pose) {
  const shoulders = (pose[IDX.ls].x + pose[IDX.rs].x) / 2;
  const hips = (pose[IDX.lh].x + pose[IDX.rh].x) / 2;
  return 1 - (shoulders + hips) / 2;
}

/* ── Player identity ─────────────────────────────────────────────────
   Sorting detections by x and assigning by index swaps the two players
   the instant they drift past each other. Each player instead keeps an
   "anchor" — a smoothed centre for whoever owns that side — and
   detections are matched to anchors by nearest total distance.
   ─────────────────────────────────────────────────────────────────── */
export function createPoseTracker() {
  const anchors = [0.25, 0.75];
  return {
    anchors,
    reset() { anchors[0] = 0.25; anchors[1] = 0.75; },
    // Returns [landmarksOrNull, landmarksOrNull] for player 1 and 2.
    assign(poses) {
      const out = [null, null];
      const found = poses.filter(isUsable).map((pose) => ({ pose, cx: poseCenter(pose) }));
      if (found.length === 0) return out;

      const claim = (side, detection, moveAnchor) => {
        out[side] = detection.pose;
        if (moveAnchor) anchors[side] = clamp(lerp(anchors[side], detection.cx, 0.15), 0.05, 0.95);
      };

      if (found.length === 1) {
        const [only] = found;
        claim(Math.abs(only.cx - anchors[0]) <= Math.abs(only.cx - anchors[1]) ? 0 : 1, only, true);
        return out;
      }

      const [a, b] = found.slice(0, 2);
      const straight = Math.abs(a.cx - anchors[0]) + Math.abs(b.cx - anchors[1]);
      const swapped = Math.abs(b.cx - anchors[0]) + Math.abs(a.cx - anchors[1]);
      const [first, second] = straight <= swapped ? [a, b] : [b, a];
      // Practically on top of each other: the pairing is a coin flip, so
      // hold the anchors still rather than corrupting them.
      const separated = Math.abs(a.cx - b.cx) > 0.1;
      claim(0, first, separated);
      claim(1, second, separated);
      return out;
    },
  };
}

/* ── The four target poses ───────────────────────────────────────── */
export const POSES = [
  {
    id: "armsup",
    label: "ARMS UP",
    check: (p, u) => p.lw.y < p.ls.y - 0.25 * u && p.rw.y < p.rs.y - 0.25 * u,
    arms: { la: -0.9, ra: -0.9 },
  },
  {
    id: "tpose",
    label: "T-POSE",
    check: (p, u) =>
      Math.abs(p.lw.y - p.ls.y) < 0.45 * u &&
      Math.abs(p.rw.y - p.rs.y) < 0.45 * u &&
      Math.abs(p.lw.x - p.ls.x) > 0.7 * u &&
      Math.abs(p.rw.x - p.rs.x) > 0.7 * u,
    arms: { la: 0, ra: 0 },
  },
  {
    id: "onearm",
    label: "RIGHT ARM UP",
    check: (p, u) => p.rw.y < p.rs.y - 0.25 * u && p.lw.y > p.lh.y - 0.15 * u,
    arms: { la: 0.9, ra: -0.9 },
  },
  {
    id: "handsonhead",
    label: "HANDS ON HEAD",
    check: (p, u) => gap(p.lw, p.nose) < 0.75 * u && gap(p.rw, p.nose) < 0.75 * u,
    arms: { la: -1.6, ra: -1.6 },
  },
];

export const matchesPose = (pose, landmarks, view) => {
  const points = getPoints(landmarks, view);
  return !!points && pose.check(points, bodyUnit(points));
};

/* ── Drawing ─────────────────────────────────────────────────────── */
export function drawSkeleton(ctx, landmarks, view, { color = "#fff", glow = 8, dots = true } = {}) {
  const points = {};
  for (const [name, index] of Object.entries(IDX)) {
    const landmark = landmarks[index];
    if (landmark) points[name] = toCanvasPoint(landmark, view);
  }
  ctx.save();
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  for (const [a, b] of BONES) {
    if (!points[a] || !points[b]) continue;
    ctx.beginPath();
    ctx.moveTo(points[a].x, points[a].y);
    ctx.lineTo(points[b].x, points[b].y);
    ctx.stroke();
  }
  if (dots) {
    ctx.fillStyle = color;
    for (const name of ["lw", "rw", "nose"]) {
      if (!points[name]) continue;
      ctx.beginPath();
      ctx.arc(points[name].x, points[name].y, name === "nose" ? 9 : 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  return points;
}

// Stick figure used as a target on the board.
export function drawStickFigure(ctx, cx, cy, s, arms, color, glow = 10) {
  const { la, ra } = arms;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  ctx.beginPath();
  ctx.arc(cx, cy - s * 1.6, s * 0.35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 1.25);
  ctx.lineTo(cx, cy);
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx - Math.cos(la) * s, cy - s + Math.sin(la) * s);
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + Math.cos(ra) * s, cy - s + Math.sin(ra) * s);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - s * 0.5, cy + s);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + s * 0.5, cy + s);
  ctx.stroke();
  ctx.restore();
}

/* Motion magnitude in body units per second — scale-invariant, so a
   player at the back of the room is judged the same as one up close. */
export function createMotionMeter(smoothing = 0.35) {
  let previous = null;
  let value = 0;
  return {
    get value() { return value; },
    reset() { previous = null; value = 0; },
    update(points, dt) {
      if (!points || dt <= 0) { previous = points; return value; }
      if (previous) {
        const unit = bodyUnit(points);
        let sum = 0;
        let count = 0;
        for (const name of ["nose", "ls", "rs", "lw", "rw", "lh", "rh"]) {
          if (!previous[name]) continue;
          sum += gap(points[name], previous[name]);
          count++;
        }
        const raw = count ? (sum / count) / unit / dt : 0;
        value = lerp(value, raw, smoothing);
      }
      previous = points;
      return value;
    },
  };
}
