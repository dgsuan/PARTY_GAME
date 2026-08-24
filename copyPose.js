import { toCanvasPoint, createFx, pickRandom } from "./utils.js";
import { C } from "./theme.js";
import { sfx } from "./audio.js";

// Pose checks work directly on normalized landmarks (0-1), no canvas
// mapping needed, since we only compare landmarks against each other.
const POSES = [
  {
    id: "armsup",
    label: "ARMS UP",
    check: (p) => p.lw.y < p.ls.y - 0.06 && p.rw.y < p.rs.y - 0.06,
    arms: { la: -0.9, ra: -0.9 },
  },
  {
    id: "tpose",
    label: "T-POSE",
    check: (p) =>
      Math.abs(p.lw.y - p.ls.y) < 0.09 &&
      Math.abs(p.rw.y - p.rs.y) < 0.09 &&
      Math.abs(p.lw.x - p.ls.x) > 0.16 &&
      Math.abs(p.rw.x - p.rs.x) > 0.16,
    arms: { la: 0, ra: 0 },
  },
  {
    id: "onearm",
    label: "RIGHT ARM UP",
    check: (p) => p.rw.y < p.rs.y - 0.06 && p.lw.y > p.lh.y,
    arms: { la: 0.9, ra: -0.9 },
  },
  {
    id: "handsonhead",
    label: "HANDS ON HEAD",
    check: (p) =>
      Math.hypot(p.lw.x - p.nose.x, p.lw.y - p.nose.y) < 0.16 &&
      Math.hypot(p.rw.x - p.nose.x, p.rw.y - p.nose.y) < 0.16,
    arms: { la: -1.6, ra: -1.6 },
  },
];

const IDX = { nose: 0, ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24 };
const BONES = [
  ["ls", "rs"], ["ls", "lh"], ["rs", "rh"], ["lh", "rh"],
  ["ls", "le"], ["le", "lw"], ["rs", "re"], ["re", "rw"],
];

const START_SPEED = 0.11;   // progress/sec toward the danger line
const SPEED_STEP = 0.018;   // added per successful pose
const HOLD_TIME = 0.35;     // seconds a pose must be held to count
const LIVES = 3;

export function createCopyPose() {
  return {
    id: "copypose",
    title: "Copy the Pose",
    icon: "🧍",
    blurb: "Match your target pose before the wall reaches you. Three lives each.",
    players: "2P VS",
    hint: "Both players step back — full body in frame",
    mode: "pose",
    numPoses: 2,

    init({ view }) {
      this.view = view;
      this.players = [createPlayer(), createPlayer()];
      this.fx = createFx();
      this.over = false;
    },

    onResize(view) {
      this.view = view;
    },

    onResults(poses) {
      for (const player of this.players) player.landmarks = null;

      const detected = poses
        .filter((pose) => pose[IDX.ls] && pose[IDX.rs] && pose[IDX.lh] && pose[IDX.rh])
        .sort((first, second) => this.poseCenter(first) - this.poseCenter(second));

      if (detected.length === 1) {
        const side = this.poseCenter(detected[0]) < 0.5 ? 0 : 1;
        this.players[side].landmarks = detected[0];
      } else {
        for (const [index, pose] of detected.slice(0, 2).entries()) {
          this.players[index].landmarks = pose;
        }
      }
    },

    // Mirrored screen-space centre of a pose, 0 (left) to 1 (right).
    poseCenter(pose) {
      const shoulderCenter = (pose[IDX.ls].x + pose[IDX.rs].x) / 2;
      const hipCenter = (pose[IDX.lh].x + pose[IDX.rh].x) / 2;
      return 1 - (shoulderCenter + hipCenter) / 2;
    },

    getPoints(landmarks) {
      if (!landmarks) return null;
      const points = {};
      for (const [name, index] of Object.entries(IDX)) points[name] = landmarks[index];
      return points;
    },

    update(dt) {
      if (this.over) return;
      this.fx.update(dt);

      for (const [index, player] of this.players.entries()) {
        if (player.flashT > 0) player.flashT -= dt;
        if (player.winT > 0) player.winT -= dt;

        const points = this.getPoints(player.landmarks);
        player.matched = !!points && player.current.check(points);

        if (player.matched) {
          player.holdTimer += dt;
          if (player.holdTimer >= HOLD_TIME) {
            player.score += 1;
            player.speed += SPEED_STEP;
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

        player.progress += player.speed * dt;
        if (player.progress >= 1) {
          player.lives -= 1;
          player.flashT = 0.35;
          player.progress = 0;
          player.holdTimer = 0;
          player.current = pickRandom(POSES, player.current);
          sfx.fail();
        }
      }

      this.over = this.players.some((player) => player.lives <= 0);
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

        // Skeleton first, so the target card sits on top of it.
        if (player.landmarks) this.drawSkeleton(ctx, player, accent);

        // The advancing wall.
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

        // Target label + hold meter.
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

        // Danger line for this half.
        ctx.save();
        ctx.strokeStyle = `rgba(255, 77, 77, ${0.35 + urgency * 0.5})`;
        ctx.setLineDash([7, 9]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(originX + 6, dangerY);
        ctx.lineTo(originX + half - 6, dangerY);
        ctx.stroke();
        ctx.restore();

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

      // Divider drawn last so it stays legible over the wall gradients.
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

    getHud() {
      const pod = (side) => {
        const player = this.players[side];
        return {
          value: player.score,
          meta: `${"◆".repeat(player.lives)}${"◇".repeat(Math.max(0, LIVES - player.lives))}  SPD ${player.speed.toFixed(2)}`,
          ratio: 1 - player.progress,
        };
      };
      const closest = Math.max(this.players[0].progress, this.players[1].progress);
      return {
        p1: pod(0),
        p2: pod(1),
        center: {
          value: Math.max(this.players[0].score, this.players[1].score),
          label: closest > 0.75 ? "DANGER" : "LEAD",
          ratio: 1 - closest,
          danger: closest > 0.75,
        },
      };
    },

    isOver() {
      return this.over;
    },

    getSummary() {
      const [a, b] = this.players;
      const title = a.lives <= 0 && b.lives <= 0
        ? "BOTH WALLS BREACHED"
        : a.lives <= 0 ? "PLAYER 2 WINS" : "PLAYER 1 WINS";
      const color = a.lives <= 0 && b.lives <= 0 ? C.amber : a.lives <= 0 ? C.p2 : C.p1;
      const top = Math.max(a.score, b.score, 1);
      return {
        title,
        color,
        record: Math.max(a.score, b.score),
        rows: [
          { tag: "P1", text: `${a.lives} ${a.lives === 1 ? "life" : "lives"} left`, value: `${a.score} poses`, ratio: a.score / top, color: C.p1 },
          { tag: "P2", text: `${b.lives} ${b.lives === 1 ? "life" : "lives"} left`, value: `${b.score} poses`, ratio: b.score / top, color: C.p2 },
        ],
      };
    },
  };
}

function createPlayer() {
  return {
    lives: LIVES,
    score: 0,
    speed: START_SPEED,
    progress: 0,
    holdTimer: 0,
    landmarks: null,
    matched: false,
    flashT: 0,
    winT: 0,
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
