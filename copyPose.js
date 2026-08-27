import { toCanvasPoint, createFx, pickRandom, clamp, lerp, frameAspect } from "./utils.js";
import { C } from "./theme.js";
import { sfx } from "./audio.js";

const IDX = { nose: 0, ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24 };
const BONES = [
  ["ls", "rs"], ["ls", "lh"], ["rs", "rh"], ["lh", "rh"],
  ["ls", "le"], ["le", "lw"], ["rs", "re"], ["re", "rw"],
];

const MATCH_TIME = 40;
const START_SPEED = 0.11;   // progress/sec toward the danger line
const SPEED_STEP = 0.018;   // added per successful pose
const HOLD_TIME = 0.35;     // seconds a pose must be held to count
const MIN_VISIBILITY = 0.5;

/* ── Body-relative measurement ───────────────────────────────────────
   Landmarks are normalized to the *frame*, so a player standing further
   away — or sharing the frame with a second player — produces smaller
   deltas for the exact same gesture. Fixed thresholds therefore fail for
   whoever is smaller on screen. Every check below is expressed in "body
   units" instead: one unit ≈ the player's torso, so a pose registers the
   same whether they fill the frame or half of it.
   Points are also aspect-corrected before measuring (see getPoints): x is
   normalised by frame width and y by frame height, so on a 16:9 camera a
   T-pose's horizontal reach reads ~44% smaller than the identical distance
   measured vertically. Without that correction the T-POSE check is
   unreachable for anyone not filling the frame.
   ─────────────────────────────────────────────────────────────────── */
function bodyUnit(p) {
  const shoulderMid = { x: (p.ls.x + p.rs.x) / 2, y: (p.ls.y + p.rs.y) / 2 };
  const hipMid = { x: (p.lh.x + p.rh.x) / 2, y: (p.lh.y + p.rh.y) / 2 };
  const torso = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);
  const shoulders = Math.hypot(p.ls.x - p.rs.x, p.ls.y - p.rs.y);
  return Math.max(0.06, torso, shoulders * 0.85);
}

const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const POSES = [
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

export function createCopyPose() {
  return {
    id: "copypose",
    title: "Copy the Pose",
    icon: "🧍",
    blurb: "Match more target poses than your rival before the clock runs out.",
    players: "2P VS",
    hint: "Both players step back — full body in frame, one each side",
    tutorial: [
      "Stand back until your whole body fits in your half.",
      "Copy the stick figure, then hold it until the meter fills.",
      "Most poses when the clock runs out wins the round.",
    ],
    mode: "pose",
    numPoses: 2,

    init({ view, practice = false }) {
      this.view = view;
      this.practice = practice;
      this.drill = [0, 0];
      this.players = [createPlayer(0.25), createPlayer(0.75)];
      // The warm-up freezes the wall: learn the pose without the pressure.
      // It also opens on ARMS UP, the easiest pose to perform and the one
      // the tracker reads most reliably.
      if (practice) {
        for (const player of this.players) {
          player.speed = 0;
          player.current = POSES[0];
        }
      }
      this.timeLeft = MATCH_TIME;
      this.fx = createFx();
      this.over = false;
    },

    onResize(view) {
      this.view = view;
    },

    /* ── Player identity ─────────────────────────────────────────────
       Sorting detections by x and assigning by index swaps the two
       players the instant they drift past each other or overlap — the
       target, the wall and the score all jump to the wrong half.
       Instead each player keeps an "anchor": a smoothed screen-space
       centre for whoever owns that side. Detections are matched to the
       anchors by nearest total distance, so identity survives players
       standing close together, crossing, or briefly merging.
       ─────────────────────────────────────────────────────────────── */
    onResults(poses) {
      for (const player of this.players) player.landmarks = null;

      const detected = poses
        .filter((pose) => isUsable(pose))
        .map((pose) => ({ pose, cx: this.poseCenter(pose) }));

      if (detected.length === 0) return;

      if (detected.length === 1) {
        const [only] = detected;
        const side = Math.abs(only.cx - this.players[0].anchor) <= Math.abs(only.cx - this.players[1].anchor) ? 0 : 1;
        this.claim(side, only, true);
        return;
      }

      // Two candidates: pick the pairing with the lower total anchor cost.
      const [a, b] = detected.slice(0, 2);
      const straight = Math.abs(a.cx - this.players[0].anchor) + Math.abs(b.cx - this.players[1].anchor);
      const swapped = Math.abs(b.cx - this.players[0].anchor) + Math.abs(a.cx - this.players[1].anchor);
      const [first, second] = straight <= swapped ? [a, b] : [b, a];

      // When the two are practically on top of each other the pairing is a
      // coin flip, so hold the anchors still rather than corrupting them.
      const separated = Math.abs(a.cx - b.cx) > 0.1;
      this.claim(0, first, separated);
      this.claim(1, second, separated);
    },

    claim(side, detection, moveAnchor) {
      const player = this.players[side];
      player.landmarks = detection.pose;
      if (moveAnchor) player.anchor = clamp(lerp(player.anchor, detection.cx, 0.15), 0.05, 0.95);
    },

    // Mirrored screen-space centre of a pose, 0 (left) to 1 (right).
    poseCenter(pose) {
      const shoulderCenter = (pose[IDX.ls].x + pose[IDX.rs].x) / 2;
      const hipCenter = (pose[IDX.lh].x + pose[IDX.rh].x) / 2;
      return 1 - (shoulderCenter + hipCenter) / 2;
    },

    // Returns landmarks in a square measuring space, so horizontal and
    // vertical distances are directly comparable.
    getPoints(landmarks) {
      if (!landmarks) return null;
      const aspect = frameAspect(this.view);
      const points = {};
      for (const [name, index] of Object.entries(IDX)) {
        const landmark = landmarks[index];
        if (!landmark) return null;
        points[name] = { x: landmark.x * aspect, y: landmark.y };
      }
      return points;
    },

    update(dt) {
      if (this.over) return;
      this.fx.update(dt);
      if (!this.practice) this.timeLeft -= dt;
      if (!this.practice && this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.over = true;
        return;
      }

      for (const [index, player] of this.players.entries()) {
        if (player.flashT > 0) player.flashT -= dt;
        if (player.winT > 0) player.winT -= dt;

        const points = this.getPoints(player.landmarks);
        player.matched = !!points && player.current.check(points, bodyUnit(points));

        if (player.matched) {
          player.holdTimer += dt;
          if (player.holdTimer >= HOLD_TIME) {
            player.score += 1;
            this.drill[index] += 1;
            if (!this.practice) player.speed += SPEED_STEP;
            player.progress = 0;
            player.holdTimer = 0;
            player.winT = 0.45;
            // Each player advances their *own* target: one player clearing a
            // pose must not swap the other player's target mid-attempt.
            player.current = pickRandom(POSES, player.current);
            const x = this.view.width * (index === 0 ? 0.25 : 0.75);
            this.fx.burst(x, this.view.height * 0.45, index === 0 ? C.p1 : C.p2, 14, 210);
            this.fx.text(x, this.view.height * 0.4, "+1", index === 0 ? C.p1 : C.p2);
            sfx.match();
          }
        } else {
          player.holdTimer = 0;
        }

        if (this.practice) {
          player.stuckT = player.matched ? 0 : (player.stuckT || 0) + dt;
          if (player.stuckT > 10) {
            player.stuckT = 0;
            player.current = pickRandom(POSES, player.current);
          }
        }

        player.progress += player.speed * dt;
        if (player.progress >= 1) {
          // A breach costs a pose, not a life: it eases off the pressure and
          // deals a fresh target so a stuck player can get back into it.
          player.misses += 1;
          player.flashT = 0.35;
          player.progress = 0;
          player.holdTimer = 0;
          player.speed = Math.max(START_SPEED, player.speed - SPEED_STEP);
          player.current = pickRandom(POSES, player.current);
          sfx.fail();
        }
      }
    },

    draw(ctx) {
      const { view } = this;
      const dangerY = view.height * 0.84;
      const half = view.width / 2;

      for (const [index, player] of this.players.entries()) {
        const left = index === 0;
        const originX = left ? 0 : half;
        const centerX = originX + half / 2;
        const accent = left ? C.p1 : C.p2;
        const wallY = 44 + player.progress * (dangerY - 74);
        const urgency = player.progress;

        if (player.landmarks) this.drawSkeleton(ctx, player, accent);

        ctx.save();
        const grad = ctx.createLinearGradient(0, wallY - 70, 0, wallY + 70);
        const tint = player.matched ? "34, 230, 200" : urgency > 0.7 ? "255, 77, 77" : "255, 194, 71";
        grad.addColorStop(0, `rgba(${tint}, 0)`);
        grad.addColorStop(0.5, `rgba(${tint}, ${0.1 + urgency * 0.14})`);
        grad.addColorStop(1, `rgba(${tint}, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(originX, wallY - 70, half, 140);

        ctx.strokeStyle = player.matched ? C.p1 : urgency > 0.7 ? C.danger : C.amber;
        ctx.lineWidth = 2;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.moveTo(originX + 12, wallY + 62);
        ctx.lineTo(originX + half - 12, wallY + 62);
        ctx.stroke();
        ctx.restore();

        drawTarget(ctx, centerX, wallY, 30, player);

        ctx.save();
        ctx.font = '700 14px "Space Grotesk", sans-serif';
        ctx.textAlign = "center";
        ctx.fillStyle = player.matched ? C.p1 : C.text;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fillText(player.current.label, centerX, wallY + 54);
        ctx.restore();

        if (player.matched) {
          const hold = Math.min(1, player.holdTimer / HOLD_TIME);
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.16)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(centerX - 34, wallY + 66);
          ctx.lineTo(centerX + 34, wallY + 66);
          ctx.stroke();
          ctx.strokeStyle = C.p1;
          ctx.shadowColor = C.p1;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(centerX - 34, wallY + 66);
          ctx.lineTo(centerX - 34 + 68 * hold, wallY + 66);
          ctx.stroke();
          ctx.restore();
        }

        ctx.save();
        ctx.strokeStyle = `rgba(255, 77, 77, ${0.35 + urgency * 0.5})`;
        ctx.setLineDash([7, 9]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(originX + 6, dangerY);
        ctx.lineTo(originX + half - 6, dangerY);
        ctx.stroke();
        ctx.restore();

        // Tell a player their side has lost tracking — the most common
        // failure is simply standing outside the frame.
        if (!player.landmarks) {
          ctx.save();
          ctx.font = '700 12px "JetBrains Mono", monospace';
          ctx.textAlign = "center";
          ctx.fillStyle = C.amber;
          ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 260) * 0.35;
          ctx.fillText(`PLAYER ${index + 1} — STEP INTO FRAME`, centerX, dangerY + 26);
          ctx.restore();
        }

        if (player.flashT > 0) {
          ctx.save();
          ctx.globalAlpha = (player.flashT / 0.35) * 0.45;
          ctx.fillStyle = C.danger;
          ctx.fillRect(originX, 0, half, view.height);
          ctx.restore();
        }
        if (player.winT > 0) {
          ctx.save();
          ctx.globalAlpha = (player.winT / 0.45) * 0.22;
          ctx.fillStyle = accent;
          ctx.fillRect(originX, 0, half, view.height);
          ctx.restore();
        }
      }

      this.fx.draw(ctx);

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([12, 10]);
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(half, view.height);
      ctx.stroke();
      ctx.restore();
    },

    drawSkeleton(ctx, player, accent) {
      const color = player.matched ? C.p1 : "rgba(233, 236, 255, 0.75)";
      const points = {};
      for (const [name, index] of Object.entries(IDX)) {
        const landmark = player.landmarks[index];
        if (landmark) points[name] = toCanvasPoint(landmark, this.view);
      }
      ctx.save();
      ctx.strokeStyle = color;
      ctx.shadowColor = player.matched ? C.p1 : accent;
      ctx.shadowBlur = player.matched ? 16 : 8;
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      for (const [a, b] of BONES) {
        if (!points[a] || !points[b]) continue;
        ctx.beginPath();
        ctx.moveTo(points[a].x, points[a].y);
        ctx.lineTo(points[b].x, points[b].y);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      for (const name of ["lw", "rw", "nose"]) {
        if (!points[name]) continue;
        ctx.beginPath();
        ctx.arc(points[name].x, points[name].y, name === "nose" ? 9 : 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },

    getDrill() {
      const target = 1;
      return {
        label: "MATCH 1 POSE EACH",
        tip: "Copy the stick figure and hold it until the meter fills",
        target,
        progress: this.drill,
        done: this.drill[0] >= target && this.drill[1] >= target,
      };
    },

    getHud() {
      const top = Math.max(this.players[0].score, this.players[1].score, 1);
      const pod = (side) => {
        const player = this.players[side];
        return {
          value: player.score,
          meta: player.landmarks
            ? `${player.misses} MISSED · SPD ${player.speed.toFixed(2)}`
            : "NO SUBJECT",
          ratio: player.score / top,
        };
      };
      return {
        p1: pod(0),
        p2: pod(1),
        center: {
          value: Math.ceil(this.timeLeft),
          label: "TIME",
          ratio: this.timeLeft / MATCH_TIME,
          danger: this.timeLeft <= 6,
        },
      };
    },

    isOver() {
      return this.over;
    },

    getSummary() {
      const [a, b] = this.players;
      const winner = a.score > b.score ? 1 : b.score > a.score ? 2 : null;
      const top = Math.max(a.score, b.score, 1);
      return {
        title: winner ? `PLAYER ${winner} WINS` : "DRAW",
        color: winner === 1 ? C.p1 : winner === 2 ? C.p2 : C.amber,
        winner,
        // Level on poses? Whoever let fewer walls through was steadier.
        tiebreak: [-a.misses, -b.misses],
        record: Math.max(a.score, b.score),
        rows: [
          { tag: "P1", text: `${a.misses} wall${a.misses === 1 ? "" : "s"} breached`, value: `${a.score} poses`, ratio: a.score / top, color: C.p1 },
          { tag: "P2", text: `${b.misses} wall${b.misses === 1 ? "" : "s"} breached`, value: `${b.score} poses`, ratio: b.score / top, color: C.p2 },
        ],
      };
    },
  };
}

// A pose is only usable if the landmarks the checks depend on are actually
// visible; a half-occluded player otherwise produces confident nonsense.
function isUsable(pose) {
  for (const index of [IDX.ls, IDX.rs, IDX.lh, IDX.rh]) {
    const landmark = pose[index];
    if (!landmark) return false;
    if (landmark.visibility !== undefined && landmark.visibility < MIN_VISIBILITY) return false;
  }
  return true;
}

function createPlayer(anchor) {
  return {
    score: 0,
    misses: 0,
    speed: START_SPEED,
    progress: 0,
    holdTimer: 0,
    landmarks: null,
    matched: false,
    flashT: 0,
    winT: 0,
    anchor,                 // smoothed screen-space centre of this player
    current: POSES[Math.floor(Math.random() * POSES.length)],
  };
}

// The target the player must copy: a stick figure inside a bevelled plate.
function drawTarget(ctx, cx, cy, s, player) {
  const { la, ra } = player.current.arms;
  const hit = player.matched;
  const stroke = hit ? C.p1 : "#ffffff";

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.shadowColor = stroke;
  ctx.shadowBlur = hit ? 18 : 10;

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
