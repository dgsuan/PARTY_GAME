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
    blurb: "1 player · match the pose before the wall reaches you · 3 lives",
    mode: "pose",

    init({ canvas, ctx }) {
      this.canvas = canvas;
      this.ctx = ctx;
      this.lives = 3;
      this.score = 0;
      this.speed = START_SPEED;
      this.progress = 0; // 0 = wall far away, 1 = wall hits the line
      this.holdTimer = 0;
      this.current = POSES[Math.floor(Math.random() * POSES.length)];
      this.landmarks = null;
      this.matched = false;
      this.over = false;
      this.flashT = 0; // brief red flash when losing a life
    },

    onResults(pose) {
      this.landmarks = pose;
    },

    getPoints() {
      const lm = this.landmarks;
      if (!lm) return null;
      return {
        nose: lm[IDX.nose], ls: lm[IDX.ls], rs: lm[IDX.rs],
        lw: lm[IDX.lw], rw: lm[IDX.rw], lh: lm[IDX.lh], rh: lm[IDX.rh],
      };
    },

    update(dt) {
      if (this.over) return;
      if (this.flashT > 0) this.flashT -= dt;

      const pts = this.getPoints();
      this.matched = !!pts && this.current.check(pts);

      if (this.matched) {
        this.holdTimer += dt;
        if (this.holdTimer >= HOLD_TIME) {
          this.score += 1;
          this.speed += SPEED_STEP;
          this.progress = 0;
          this.holdTimer = 0;
          this.current = pickNext(this.current);
        }
      } else {
        this.holdTimer = 0;
      }

      this.progress += this.speed * dt;
      if (this.progress >= 1) {
        this.lives -= 1;
        this.flashT = 0.3;
        this.progress = 0;
        this.holdTimer = 0;
        this.current = pickNext(this.current);
        if (this.lives <= 0) this.over = true;
      }
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
      const wallY = 40 + this.progress * (dangerY - 60);
      ctx.save();
      ctx.fillStyle = this.matched ? "rgba(53,255,143,0.18)" : "rgba(255,176,32,0.14)";
      ctx.fillRect(0, wallY - 55, canvas.width, 110);
      ctx.restore();

      this.current.icon(ctx, canvas.width / 2, wallY, 34, this.matched);

      ctx.save();
      ctx.font = "bold 16px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = this.matched ? "#35ff8f" : "#ffb020";
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 8;
      ctx.fillText(this.current.label, canvas.width / 2, wallY + 62);
      if (this.matched && this.holdTimer > 0) {
        ctx.fillText("HOLD IT!", canvas.width / 2, wallY + 82);
      }
      ctx.restore();

      // skeleton feedback dots for the player
      if (this.landmarks) {
        ctx.save();
        for (const idx of Object.values(IDX)) {
          const p = toCanvasPoint(this.landmarks[idx], canvas);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = this.matched ? "#35ff8f" : "#ffffff";
          ctx.fill();
        }
        ctx.restore();
      }

      if (this.flashT > 0) {
        ctx.save();
        ctx.globalAlpha = this.flashT / 0.3 * 0.4;
        ctx.fillStyle = "#ff3b3b";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }

      // HUD
      ctx.save();
      ctx.font = "bold 18px monospace";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillStyle = "#ff5fae";
      ctx.shadowColor = "#ff5fae";
      ctx.shadowBlur = 8;
      ctx.fillText("♥".repeat(this.lives) + "♡".repeat(3 - this.lives), 12, 10);
      ctx.textAlign = "right";
      ctx.fillStyle = "#35ff8f";
      ctx.shadowColor = "#35ff8f";
      ctx.fillText(`SCORE ${this.score}`, canvas.width - 12, 10);
      ctx.restore();
    },

    isOver() {
      return this.over;
    },

    getSummary() {
      return {
        title: "WALL BREACHED",
        color: "#ff3b3b",
        lines: [`You matched ${this.score} poses`],
      };
    },
  };
}

function pickNext(current) {
  let next;
  do {
    next = POSES[Math.floor(Math.random() * POSES.length)];
  } while (next === current && POSES.length > 1);
  return next;
}
