import { bodyUnit } from "./poseKit.js";

/* ═══════════════════════════════════════════════════════════════════
   EXPANDED POSE LIBRARY — Copy the Pose only.

   The base four in poseKit are shared with Echo and Vault Sync, so the
   expansion lives here and is imported by Copy the Pose alone. Nothing
   about how poses are DRAWN changes: every pose here is expressed with
   the same {la, ra} arm angles the existing stick figure already
   renders, so the target stays exactly as crisp as before. The added
   difficulty comes from variety and the shorter window, not from
   muddier visuals.
   ═══════════════════════════════════════════════════════════════════ */

/* ── CONFIG ───────────────────────────────────────────────────────── */
const MIN_EXTENSION = 0.45;   // body units an arm must reach to count
const BAND = {                // angle bands, radians, "up" positive
  up: [1.05, Math.PI],
  diagUp: [0.35, 1.05],
  out: [-0.35, 0.35],
  diagDown: [-1.05, -0.35],
  down: [-Math.PI, -1.05],
};
// Drawing angles for the existing stick figure (negative points upward).
const DRAW = { up: -1.45, diagUp: -0.75, out: 0, diagDown: 0.75, down: 1.45, across: 2.3 };

/* An arm as (outward, upward) in body units. Outward is derived from the
   player's own shoulder axis, so it stays correct whichever way the
   landmark convention runs and whichever way the player is turned. */
function arm(points, side, unit) {
  const sign = Math.sign(points.ls.x - points.rs.x) || 1;
  const wrist = side === "l" ? points.lw : points.rw;
  const shoulder = side === "l" ? points.ls : points.rs;
  const direction = side === "l" ? sign : -sign;
  return {
    out: ((wrist.x - shoulder.x) * direction) / unit,
    up: -(wrist.y - shoulder.y) / unit,
  };
}

function inZone(points, side, zone, unit) {
  const vector = arm(points, side, unit);
  if (zone === "across") return vector.out < -0.3;          // crossed the body
  const length = Math.hypot(vector.out, vector.up);
  if (zone !== "down" && length < MIN_EXTENSION) return false;
  if (vector.out < -0.3) return false;                       // that is "across"
  const angle = Math.atan2(vector.up, Math.max(vector.out, 0.001));
  const [lo, hi] = BAND[zone];
  return angle >= lo && angle <= hi;
}

function makePose(id, label, left, right) {
  return {
    id,
    label,
    zones: [left, right],
    symmetric: left === right,
    arms: { la: DRAW[left], ra: DRAW[right] },
    check: (p, u) => inZone(p, "l", left, u) && inZone(p, "r", right, u),
  };
}

/* Every combination of five arm positions, minus the three that would
   duplicate a base pose, plus three cross-body shapes. 25 new poses —
   and with mirroring, up to 44 distinct things to copy. */
const ZONES = ["up", "diagUp", "out", "diagDown", "down"];
const NAME = { up: "HIGH", diagUp: "RAISED", out: "WIDE", diagDown: "LOW", down: "DOWN" };
const DUPLICATES = new Set(["up|up", "out|out", "down|up"]);   // base pose shapes

const GRID = [];
for (const left of ZONES) {
  for (const right of ZONES) {
    if (DUPLICATES.has(`${left}|${right}`)) continue;
    GRID.push(makePose(
      `x-${left}-${right}`,
      left === right ? `BOTH ${NAME[left]}` : `${NAME[left]} / ${NAME[right]}`,
      left, right,
    ));
  }
}

const CROSSED = [
  makePose("x-cross-left", "CROSS / HIGH", "across", "up"),
  makePose("x-cross-right", "HIGH / CROSS", "up", "across"),
  makePose("x-cross-both", "ARMS CROSSED", "across", "across"),
];

export const EXTRA_POSES = [...GRID, ...CROSSED];

/* ── Mirroring ───────────────────────────────────────────────────────
   Swapping the landmark sides flips which arm each check inspects, and
   swapping the two draw angles flips the stick figure to match. Purely
   symmetric poses are returned untouched, since flipping them would
   produce an identical target and waste the coin flip.
   ─────────────────────────────────────────────────────────────────── */
function swapSides(p) {
  return { ...p, ls: p.rs, rs: p.ls, lw: p.rw, rw: p.lw, le: p.re, re: p.le, lh: p.rh, rh: p.lh };
}

export function mirrorPose(pose) {
  if (!pose || pose.symmetric || !pose.arms) return pose;
  return {
    id: `${pose.id}-m`,
    base: pose,
    label: pose.label,          // the figure shows which side; the words stay stable
    symmetric: false,
    arms: { la: pose.arms.ra, ra: pose.arms.la },
    check: (p, u) => pose.check(swapSides(p), u),
  };
}

// Exposed so the pool size can be asserted in tests.
export const POSE_COUNT = EXTRA_POSES.length;
export { bodyUnit };
