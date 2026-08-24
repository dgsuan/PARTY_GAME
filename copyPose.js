import { toCanvasPoint } from "./utils.js";

// Pose checks work directly on normalized landmarks (0-1), no canvas
// mapping needed, since we only compare landmarks against each other.
const POSES = [
  {
    id: "armsup",
    label: "ARMS UP",
    check: (p) => p.lw.y < p.ls.y - 0.06 && p.rw.y < p.rs.y - 0.06,
    icon: (ctx, cx, cy, s, hit) => stick(ctx, cx, cy, s, hit, { la: -0.9, ra: -0.9 }),
  },
  {
    id: "tpose",
    label: "T-POSE",
    check: (p) =>
      Math.abs(p.lw.y - p.ls.y) < 0.09 &&
      Math.abs(p.rw.y - p.rs.y) < 0.09 &&
      Math.abs(p.lw.x - p.ls.x) > 0.16 &&
      Math.abs(p.rw.x - p.rs.x) > 0.16,
    icon: (ctx, cx, cy, s, hit) => stick(ctx, cx, cy, s, hit, { la: 0, ra: 0 }),
  },
  {
    id: "onearm",
    label: "RIGHT ARM UP",
    check: (p) => p.rw.y < p.rs.y - 0.06 && p.lw.y > p.lh.y,
    icon: (ctx, cx, cy, s, hit) => stick(ctx, cx, cy, s, hit, { la: 0.9, ra: -0.9 }),
  },
  {
    id: "handsonhead",
    label: "HANDS ON HEAD",
    check: (p) =>
      Math.hypot(p.lw.x - p.nose.x, p.lw.y - p.nose.y) < 0.16 &&
      Math.hypot(p.rw.x - p.nose.x, p.rw.y - p.nose.y) < 0.16,
    icon: (ctx, cx, cy, s, hit) => stick(ctx, cx, cy, s, hit, { la: -1.6, ra: -1.6, hands: "head" }),
  },
];

function stick(ctx, cx, cy, s, hit, { la, ra }) {
  ctx.save();
  ctx.strokeStyle = hit ? "#35ff8f" : "#ffffff";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = 10;
  // head
  ctx.beginPath();
  ctx.arc(cx, cy - s * 1.6, s * 0.35, 0, Math.PI * 2);
  ctx.stroke();
  // spine
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 1.25);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  // arms
  ctx.beginPath();
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx - Math.cos(la) * s, cy - s + Math.sin(la) * s);
  ctx.moveTo(cx, cy - s);
  ctx.lineTo(cx + Math.cos(ra) * s, cy - s + Math.sin(ra) * s);
  ctx.stroke();
  // legs
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx - s * 0.5, cy + s);
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + s * 0.5, cy + s);
  ctx.stroke();
  ctx.restore();
}

const IDX = { nose: 0, ls: 11, rs: 12, lw: 15, rw: 16, lh: 23, rh: 24 };
const START_SPEED = 0.11; // progress/sec toward the danger line
const SPEED_STEP = 0.018; // added per successful pose
const HOLD_TIME = 0.35; // seconds a pose must be held to count

export function createCopyPose() {
  return {
    id: "copypose",
    title: "Copy the Pose",
    icon: "🧍",
    blurb: "2 players · match the pose before your wall reaches you · 3 lives",
    mode: "pose",
    numPoses: 2,

    init({ canvas, ctx }) {
      this.canvas = canvas;
      this.ctx = ctx;
      this.current = POSES[Math.floor(Math.random() * POSES.length)];
      this.players = [createPlayer(), createPlayer()];
      this.over = false;
    },

    onResults(poses) {
      this.players[0].landmarks = null;
      this.players[1].landmarks = null;
      for (const pose of poses) {
        const nose = pose[IDX.nose];
        const side = (1 - nose.x) < 0.5 ? 0 : 1;
        this.players[side].landmarks = pose;
      }
    },

    getPoints(lm) {
      if (!lm) return null;
      return {
        nose: lm[IDX.nose], ls: lm[IDX.ls], rs: lm[IDX.rs],
        lw: lm[IDX.lw], rw: lm[IDX.rw], lh: lm[IDX.lh], rh: lm[IDX.rh],
      };
    },

    update(dt) {
      if (this.over) return;
      for (const player of this.players) {
        if (player.flashT > 0) player.flashT -= dt;
        const points = this.getPoints(player.landmarks);
        player.matched = !!points && this.current.check(points);

        if (player.matched) {
          player.holdTimer += dt;
          if (player.holdTimer >= HOLD_TIME) {
            player.score += 1;
            player.speed += SPEED_STEP;
            player.progress = 0;
            player.holdTimer = 0;
            this.current = pickNext(this.current);
          }
        } else {
          player.holdTimer = 0;
        }

        player.progress += player.speed * dt;
        if (player.progress >= 1) {
          player.lives -= 1;
          player.flashT = 0.3;
          player.progress = 0;
          player.holdTimer = 0;
          this.current = pickNext(this.current);
        }
      }
      this.over = this.players.some((player) => player.lives <= 0);
    },

    draw(ctx) {
      const { canvas } = this;
      const dangerY = canvas.height * 0.82;

      // danger line
      ctx.save();
      ctx.strokeStyle = "rgba(255,59,59,0.6)";
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, dangerY);
      ctx.lineTo(canvas.width, dangerY);
      ctx.stroke();
      ctx.restore();

      // wall sliding from top toward the danger line
      for (const [index, player] of this.players.entries()) {
        const left = index === 0;
        const centerX = left ? canvas.width * 0.25 : canvas.width * 0.75;
        const wallY = 40 + player.progress * (dangerY - 60);
        ctx.save();
        ctx.fillStyle = player.matched ? "rgba(53,255,143,0.18)" : "rgba(255,176,32,0.14)";
        ctx.fillRect(left ? 0 : canvas.width / 2, wallY - 55, canvas.width / 2, 110);
        ctx.restore();

        this.current.icon(ctx, centerX, wallY, 30, player.matched);

        ctx.save();
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = player.matched ? "#35ff8f" : "#ffb020";
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.fillText(this.current.label, centerX, wallY + 56);
        if (player.matched && player.holdTimer > 0) ctx.fillText("HOLD IT!", centerX, wallY + 74);
        ctx.restore();

        if (player.landmarks) {
          ctx.save();
          for (const idx of Object.values(IDX)) {
            const point = toCanvasPoint(player.landmarks[idx], canvas);
            ctx.beginPath();
            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
            ctx.fillStyle = player.matched ? "#35ff8f" : "#ffffff";
            ctx.fill();
          }
          ctx.restore();
        }
        if (player.flashT > 0) {
          ctx.save();
          ctx.globalAlpha = player.flashT / 0.3 * 0.4;
          ctx.fillStyle = "#ff3b3b";
          ctx.fillRect(left ? 0 : canvas.width / 2, 0, canvas.width / 2, canvas.height);
          ctx.restore();
        }
      }

      ctx.save();
      ctx.font = "bold 18px monospace";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = "#35ff8f";
      ctx.shadowColor = "#35ff8f";
      ctx.shadowBlur = 8;
      ctx.fillText(`P1 ${"♥".repeat(this.players[0].lives)}${"♡".repeat(3 - this.players[0].lives)}  ${this.players[0].score}`, 12, 10);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ff5fae";
      ctx.shadowColor = "#ff5fae";
      ctx.fillText(`${this.players[1].score}  ${"♥".repeat(this.players[1].lives)}${"♡".repeat(3 - this.players[1].lives)} P2`, canvas.width - 12, 10);
      ctx.restore();
    },

    isOver() {
      return this.over;
    },

    getSummary() {
      return {
        title: "WALL BREACHED",
        color: "#ff3b3b",
        lines: [`P1 matched ${this.players[0].score} poses`, `P2 matched ${this.players[1].score} poses`],
      };
    },
  };
}

function createPlayer() {
  return { lives: 3, score: 0, speed: START_SPEED, progress: 0, holdTimer: 0, landmarks: null, matched: false, flashT: 0 };
}

function pickNext(current) {
  let next;
  do {
    next = POSES[Math.floor(Math.random() * POSES.length)];
  } while (next === current && POSES.length > 1);
  return next;
}
