import { toCanvasPoint, createFx, createShake, clamp } from "./utils.js";
import { C } from "./theme.js";
import { sfx } from "./audio.js";
import { IDX, createPoseTracker, drawSkeleton } from "./poseKit.js";

/* ═══════════════════════════════════════════════════════════════════
   BEAM DODGE — the inverse of every other channel.

   Everything else says "touch this". This says "do not get touched".
   Walls sweep down each half with a gap you must stand in; low bars
   sweep across at head height and must be ducked under. Fewest hits
   wins, which keeps it decisive even when both players survive.
   ═══════════════════════════════════════════════════════════════════ */

const MATCH_TIME = 45;
const SPAWN_START = 2.67;        // -20% gap between beams
const SPAWN_FLOOR = 1.08;        // -20% gap between beams
const GRACE = 0.6;               // was 0.7 — -15% mercy window
const BAND = 34;                 // beam thickness, px
const GAP_WIDTH = 0.27;          // was 0.3 — -10% gap to slip through

export function createBeamDodge() {
  return {
    id: "beamdodge",
    title: "Beam Dodge",
    icon: "⚡",
    blurb: "Don't get touched. Slip through the gaps and duck the low bars.",
    players: "2P VS",
    hint: "Both players step back — full body in frame, one each side",
    tutorial: [
      "Walls sweep down your half — stand in the gap to slip through.",
      "Low bars sweep across at head height — crouch under those.",
      "Fewest hits when the clock runs out wins the round.",
    ],
    mode: "pose",
    numPoses: 2,

    init({ view, practice = false }) {
      this.view = view;
      this.practice = practice;
      this.drill = [0, 0];
      this.tracker = createPoseTracker();
      this.players = [createDodger(), createDodger()];
      this.beams = [[], []];
      this.lastSpawn = [0, 0];
      this.timeLeft = MATCH_TIME;
      this.elapsed = 0;
      this.fx = createFx();
      this.shake = createShake();
      this.over = false;
    },

    onResize(view) {
      // Beams are stored in fractions of a half, so they survive a resize.
      this.view = view;
    },

    onResults(poses) {
      const assigned = this.tracker.assign(poses);
      this.players[0].landmarks = assigned[0];
      this.players[1].landmarks = assigned[1];
    },

    spawnInterval() {
      return this.practice ? 2.6 : Math.max(SPAWN_FLOOR, SPAWN_START - this.elapsed * 0.04);
    },

    spawn(side) {
      // Low bars need a crouch, which is harder, so they stay rarer.
      const low = !this.practice && Math.random() < 0.3;
      this.beams[side].push(low
        ? { kind: "low", t: 0, speed: 0.39 + Math.random() * 0.16, hit: false }
        : { kind: "wall", t: 0, speed: 0.35 + Math.random() * 0.18, gap: 0.18 + Math.random() * 0.64, width: GAP_WIDTH, hit: false });
      sfx.leak();
    },

    // Screen-space points for the body parts a beam can catch.
    bodyPoints(player) {
      if (!player.landmarks) return null;
      const wanted = [IDX.nose, IDX.ls, IDX.rs, IDX.lh, IDX.rh, IDX.lw, IDX.rw];
      const points = [];
      for (const index of wanted) {
        const landmark = player.landmarks[index];
        if (landmark) points.push(toCanvasPoint(landmark, this.view));
      }
      return points.length ? points : null;
    },

    update(dt) {
      if (this.over) return;
      this.elapsed += dt;
      this.fx.update(dt);
      this.shake.update(dt);

      if (!this.practice) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.over = true; return; }
      }

      const half = this.view.width / 2;

      for (const side of [0, 1]) {
        const player = this.players[side];
        if (player.graceT > 0) player.graceT -= dt;

        if (this.elapsed - this.lastSpawn[side] > this.spawnInterval()) {
          this.spawn(side);
          this.lastSpawn[side] = this.elapsed;
        }

        const originX = side === 0 ? 0 : half;
        const points = this.bodyPoints(player);
        player.tracked = !!points;
        if (points) player.cleanT += dt;

        for (const beam of this.beams[side]) {
          beam.t += beam.speed * dt;
          if (beam.hit || !points || player.graceT > 0) continue;

          let struck = false;
          if (beam.kind === "wall") {
            const y = beam.t * this.view.height;
            const gapX = originX + beam.gap * half;
            const gapW = beam.width * half;
            for (const point of points) {
              if (Math.abs(point.y - y) > BAND / 2) continue;
              if (point.x > gapX - gapW / 2 && point.x < gapX + gapW / 2) continue;
              struck = true;
              break;
            }
          } else {
            const x = originX + beam.t * half;
            const barY = this.view.height * 0.42;   // head height
            for (const point of points) {
              if (Math.abs(point.x - x) > BAND / 2) continue;
              if (point.y > barY + BAND / 2) continue;   // ducked below it
              struck = true;
              break;
            }
          }

          if (struck) {
            beam.hit = true;
            player.hits += 1;
            player.graceT = GRACE;
            player.best = Math.max(player.best, player.cleanT);
            player.cleanT = 0;
            player.flashT = 0.4;
            this.shake.add(8);
            sfx.bomb();
          } else if (beam.t > 1 && !beam.cleared) {
            beam.cleared = true;
            player.dodged += 1;
            if (this.practice) this.drill[side] = Math.min(1, this.drill[side] + 1);
            this.fx.text(originX + half / 2, this.view.height * 0.3, "CLEAR", side === 0 ? C.p1 : C.p2);
          }
        }
        if (player.flashT > 0) player.flashT -= dt;
        this.beams[side] = this.beams[side].filter((beam) => beam.t < 1.25);
        player.best = Math.max(player.best, player.cleanT);
      }
    },

    draw(ctx) {
      const { view } = this;
      const half = view.width / 2;
      const shaking = this.shake.apply(ctx);

      for (const side of [0, 1]) {
        const player = this.players[side];
        const originX = side === 0 ? 0 : half;
        const accent = side === 0 ? C.p1 : C.p2;

        if (player.landmarks) {
          drawSkeleton(ctx, player.landmarks, this.view, {
            color: player.graceT > 0 ? "rgba(255,255,255,0.4)" : accent,
            glow: 12,
          });
        }

        for (const beam of this.beams[side]) {
          const spent = beam.hit;
          ctx.save();
          ctx.globalAlpha = spent ? 0.25 : 1;
          const color = spent ? "#666" : C.danger;
          if (beam.kind === "wall") {
            const y = beam.t * view.height;
            const gapX = originX + beam.gap * half;
            const gapW = beam.width * half;
            const grad = ctx.createLinearGradient(0, y - BAND, 0, y + BAND);
            grad.addColorStop(0, "rgba(255,77,77,0)");
            grad.addColorStop(0.5, spent ? "rgba(120,120,120,0.6)" : "rgba(255,77,77,0.75)");
            grad.addColorStop(1, "rgba(255,77,77,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(originX, y - BAND, Math.max(0, gapX - gapW / 2 - originX), BAND * 2);
            const rightStart = gapX + gapW / 2;
            ctx.fillRect(rightStart, y - BAND, Math.max(0, originX + half - rightStart), BAND * 2);
            // Gap markers
            ctx.strokeStyle = spent ? "#666" : C.p1;
            ctx.shadowColor = ctx.strokeStyle;
            ctx.shadowBlur = 14;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(gapX - gapW / 2, y - 14); ctx.lineTo(gapX - gapW / 2, y + 14);
            ctx.moveTo(gapX + gapW / 2, y - 14); ctx.lineTo(gapX + gapW / 2, y + 14);
            ctx.stroke();
          } else {
            const x = originX + beam.t * half;
            const barY = view.height * 0.42;
            const grad = ctx.createLinearGradient(x - BAND, 0, x + BAND, 0);
            grad.addColorStop(0, "rgba(255,194,71,0)");
            grad.addColorStop(0.5, spent ? "rgba(120,120,120,0.6)" : "rgba(255,194,71,0.8)");
            grad.addColorStop(1, "rgba(255,194,71,0)");
            ctx.fillStyle = grad;
            ctx.fillRect(x - BAND, 0, BAND * 2, barY);
            ctx.strokeStyle = spent ? "#666" : C.amber;
            ctx.shadowColor = ctx.strokeStyle;
            ctx.shadowBlur = 14;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x - 16, barY); ctx.lineTo(x + 16, barY);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (!player.tracked) {
          ctx.save();
          ctx.font = '700 12px "JetBrains Mono", monospace';
          ctx.textAlign = "center";
          ctx.fillStyle = C.amber;
          ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 240) * 0.4;
          ctx.fillText(`PLAYER ${side + 1} — STEP INTO FRAME`, originX + half / 2, view.height * 0.62);
          ctx.restore();
        }

        if (player.flashT > 0) {
          ctx.save();
          ctx.globalAlpha = (player.flashT / 0.4) * 0.5;
          ctx.fillStyle = C.danger;
          ctx.fillRect(originX, 0, half, view.height);
          ctx.restore();
        }
        if (player.graceT > 0) {
          ctx.save();
          ctx.globalAlpha = 0.25 + Math.sin(this.elapsed * 22) * 0.15;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 3;
          ctx.strokeRect(originX + 6, 6, half - 12, view.height - 12);
          ctx.restore();
        }
      }

      this.fx.draw(ctx);

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.setLineDash([12, 10]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(half, view.height);
      ctx.stroke();
      ctx.restore();

      if (shaking) ctx.restore();
    },

    getDrill() {
      return {
        label: "CLEAR 1 BEAM EACH",
        tip: "Step sideways into the gap and let the wall pass",
        target: 1,
        progress: this.drill,
        done: this.drill[0] >= 1 && this.drill[1] >= 1,
      };
    },

    getHud() {
      const pod = (side) => {
        const player = this.players[side];
        return {
          value: player.hits,
          meta: player.tracked ? `${player.dodged} DODGED` : "NO SUBJECT",
          ratio: clamp(1 - player.hits / 8, 0, 1),
        };
      };
      return {
        p1: pod(0),
        p2: pod(1),
        center: {
          value: Math.ceil(this.timeLeft),
          label: "SURVIVE",
          ratio: this.timeLeft / MATCH_TIME,
          danger: this.timeLeft <= 8,
        },
      };
    },

    isOver() { return this.over; },

    getSummary() {
      const [a, b] = this.players;
      // Fewest hits wins — the only channel where a lower number is better.
      const winner = a.hits < b.hits ? 1 : b.hits < a.hits ? 2 : null;
      return {
        title: winner ? `PLAYER ${winner} WINS` : "DRAW",
        color: winner === 1 ? C.p1 : winner === 2 ? C.p2 : C.amber,
        winner,
        // Level on hits? The longer clean run was the better dodging.
        tiebreak: [a.best, b.best],
        record: Math.max(a.dodged, b.dodged),
        rows: [
          { tag: "P1", text: `${a.dodged} dodged · best run ${a.best.toFixed(1)}s`, value: `${a.hits} hits`, ratio: clamp(1 - a.hits / 8, 0, 1), color: C.p1 },
          { tag: "P2", text: `${b.dodged} dodged · best run ${b.best.toFixed(1)}s`, value: `${b.hits} hits`, ratio: clamp(1 - b.hits / 8, 0, 1), color: C.p2 },
        ],
      };
    },
  };
}

function createDodger() {
  return { hits: 0, dodged: 0, cleanT: 0, best: 0, graceT: 0, flashT: 0, tracked: false, landmarks: null };
}
