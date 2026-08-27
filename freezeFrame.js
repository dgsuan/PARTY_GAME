import { createFx, clamp } from "./utils.js";
import { C } from "./theme.js";
import { sfx } from "./audio.js";
import { getPoints, createPoseTracker, createMotionMeter, drawSkeleton } from "./poseKit.js";

/* ═══════════════════════════════════════════════════════════════════
   FREEZE FRAME — the only channel where the winning action is stopping.

   On GREEN you advance by moving. On RED you must go completely still,
   and any movement costs you ground. Motion is measured in body units
   per second, so a player at the back of the room is judged exactly the
   same as one standing close to the camera.
   ═══════════════════════════════════════════════════════════════════ */

const MATCH_TIME = 60;
const GOAL = 1;                  // progress needed to win
const GAIN_PER_MOTION = 0.022;   // advance rate while moving on green
const PENALTY = 0.15;            // was 0.13 — costlier twitch
const MOVE_THRESHOLD = 0.47;     // was 0.55 — -15%, stricter stillness
const FLINCH_GRACE = 0.15;       // was 0.18 — -15% reaction window
const GREEN_MIN = 1.8, GREEN_MAX = 4.2;
const RED_MIN = 1.6, RED_MAX = 3.4;
const WARN = 0.7;                // amber warning before red lands

export function createFreezeFrame() {
  return {
    id: "freezeframe",
    title: "Freeze Frame",
    icon: "🚦",
    blurb: "Dance on green, freeze on red. Twitch and you lose ground.",
    players: "2P VS",
    hint: "Both players step back — full body in frame, one each side",
    tutorial: [
      "GREEN light: move as much as you can to advance your marker.",
      "RED light: freeze completely — any movement costs you ground.",
      "First to the top wins. Watch for the amber warning.",
    ],
    mode: "pose",
    numPoses: 2,

    init({ view, practice = false }) {
      this.view = view;
      this.practice = practice;
      this.drill = [0, 0];
      this.tracker = createPoseTracker();
      this.players = [createRunner(), createRunner()];
      this.timeLeft = MATCH_TIME;
      this.elapsed = 0;
      this.phase = "green";        // green | warn | red
      this.phaseLeft = 2.6;
      this.fx = createFx();
      this.over = false;
    },

    onResize(view) { this.view = view; },

    onResults(poses) {
      const assigned = this.tracker.assign(poses);
      this.players[0].landmarks = assigned[0];
      this.players[1].landmarks = assigned[1];
    },

    nextPhase() {
      if (this.phase === "green") {
        this.phase = "warn";
        this.phaseLeft = WARN;
        sfx.count();
      } else if (this.phase === "warn") {
        this.phase = "red";
        this.phaseLeft = RED_MIN + Math.random() * (RED_MAX - RED_MIN);
        sfx.alarm();
      } else {
        this.phase = "green";
        this.phaseLeft = GREEN_MIN + Math.random() * (GREEN_MAX - GREEN_MIN);
        sfx.go();
      }
    },

    update(dt) {
      if (this.over) return;
      this.elapsed += dt;
      this.fx.update(dt);

      if (!this.practice) {
        this.timeLeft -= dt;
        this.phaseLeft -= dt;
        if (this.phaseLeft <= 0) this.nextPhase();
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.over = true; return; }
      } else {
        this.phase = "green";      // the drill only teaches "move to advance"
      }

      for (const [index, runner] of this.players.entries()) {
        const points = getPoints(runner.landmarks, this.view);
        runner.motion = runner.meter.update(points, dt);
        runner.tracked = !!points;
        if (runner.flashT > 0) runner.flashT -= dt;

        const moving = runner.tracked && runner.motion > MOVE_THRESHOLD;

        if (this.phase === "red") {
          // A brief grace window absorbs tracking jitter, so only real
          // movement is punished.
          runner.flinchT = moving ? runner.flinchT + dt : 0;
          if (runner.flinchT > FLINCH_GRACE) {
            runner.flinchT = 0;
            runner.progress = Math.max(0, runner.progress - PENALTY);
            runner.busted += 1;
            runner.flashT = 0.4;
            sfx.fail();
            this.fx.text(this.laneX(index), this.view.height * 0.5, "CAUGHT", C.danger);
          }
        } else {
          runner.flinchT = 0;
          if (moving) {
            const gain = Math.min(runner.motion, 4) * GAIN_PER_MOTION * dt;
            runner.progress = clamp(runner.progress + gain, 0, GOAL);
            runner.moved += gain;
            if (this.practice && runner.moved > 0.12 && this.drill[index] === 0) this.drill[index] = 1;
          }
        }

        if (!this.practice && runner.progress >= GOAL) {
          this.over = true;
          this.winner = index + 1;
        }
      }
    },

    laneX(index) { return this.view.width * (index === 0 ? 0.25 : 0.75); },

    draw(ctx) {
      const { view } = this;
      const half = view.width / 2;

      // The whole frame carries the signal colour — impossible to miss
      // from across a room.
      const tint = this.phase === "red" ? "255, 77, 77" : this.phase === "warn" ? "255, 194, 71" : "34, 230, 200";
      const pulse = this.phase === "red" ? 0.16 + Math.sin(this.elapsed * 9) * 0.05 : 0.1;
      ctx.save();
      ctx.fillStyle = `rgba(${tint}, ${pulse})`;
      ctx.fillRect(0, 0, view.width, view.height);
      ctx.strokeStyle = `rgba(${tint}, 0.85)`;
      ctx.lineWidth = 8;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 24;
      ctx.strokeRect(4, 4, view.width - 8, view.height - 8);
      ctx.restore();

      ctx.save();
      ctx.font = '700 34px "Space Grotesk", sans-serif';
      ctx.textAlign = "center";
      ctx.fillStyle = this.phase === "red" ? C.danger : this.phase === "warn" ? C.amber : C.p1;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 22;
      ctx.fillText(this.phase === "red" ? "FREEZE" : this.phase === "warn" ? "GET READY" : "MOVE", half, view.height * 0.16);
      ctx.restore();

      for (const [index, runner] of this.players.entries()) {
        const originX = index === 0 ? 0 : half;
        const accent = index === 0 ? C.p1 : C.p2;

        if (runner.landmarks) {
          const moving = runner.motion > MOVE_THRESHOLD;
          const danger = this.phase === "red" && moving;
          drawSkeleton(ctx, runner.landmarks, this.view, {
            color: danger ? C.danger : moving ? accent : "rgba(233, 236, 255, 0.7)",
            glow: danger ? 22 : 10,
          });
        }

        // Track up the side of each half.
        const trackX = index === 0 ? 22 : view.width - 22;
        const top = view.height * 0.22;
        const bottom = view.height * 0.9;
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(trackX, bottom);
        ctx.lineTo(trackX, top);
        ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.moveTo(trackX, bottom);
        ctx.lineTo(trackX, bottom - (bottom - top) * runner.progress);
        ctx.stroke();
        ctx.restore();

        // Live motion meter — shows exactly how still you are being.
        const meterY = view.height * 0.94;
        const meterW = half * 0.5;
        const meterX = originX + half / 2 - meterW / 2;
        const level = Math.min(1, runner.motion / (MOVE_THRESHOLD * 2.4));
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.fillRect(meterX, meterY, meterW, 5);
        ctx.fillStyle = this.phase === "red"
          ? (runner.motion > MOVE_THRESHOLD ? C.danger : C.p1)
          : accent;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fillRect(meterX, meterY, meterW * level, 5);
        // Threshold notch
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillRect(meterX + meterW / 2.4, meterY - 3, 2, 11);
        ctx.restore();

        if (!runner.tracked) {
          ctx.save();
          ctx.font = '700 12px "JetBrains Mono", monospace';
          ctx.textAlign = "center";
          ctx.fillStyle = C.amber;
          ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 240) * 0.4;
          ctx.fillText(`PLAYER ${index + 1} — STEP INTO FRAME`, originX + half / 2, view.height * 0.62);
          ctx.restore();
        }

        if (runner.flashT > 0) {
          ctx.save();
          ctx.globalAlpha = (runner.flashT / 0.4) * 0.5;
          ctx.fillStyle = C.danger;
          ctx.fillRect(originX, 0, half, view.height);
          ctx.restore();
        }
      }

      this.fx.draw(ctx);

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.setLineDash([12, 10]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(half, 0);
      ctx.lineTo(half, view.height);
      ctx.stroke();
      ctx.restore();
    },

    getDrill() {
      return {
        label: "MOVE TO ADVANCE",
        tip: "Wave, step, dance — motion fills your track",
        target: 1,
        progress: this.drill,
        done: this.drill[0] >= 1 && this.drill[1] >= 1,
      };
    },

    getHud() {
      const pod = (side) => {
        const runner = this.players[side];
        return {
          value: `${Math.round(runner.progress * 100)}%`,
          meta: runner.tracked ? `${runner.busted} CAUGHT` : "NO SUBJECT",
          ratio: runner.progress,
        };
      };
      return {
        p1: pod(0),
        p2: pod(1),
        center: {
          value: Math.ceil(this.timeLeft),
          label: this.phase === "red" ? "FREEZE" : this.phase === "warn" ? "READY" : "MOVE",
          ratio: this.timeLeft / MATCH_TIME,
          danger: this.phase === "red",
        },
      };
    },

    isOver() { return this.over; },

    getSummary() {
      const [a, b] = this.players;
      const winner = this.winner ?? (a.progress > b.progress ? 1 : b.progress > a.progress ? 2 : null);
      return {
        title: winner ? `PLAYER ${winner} WINS` : "DRAW",
        color: winner === 1 ? C.p1 : winner === 2 ? C.p2 : C.amber,
        winner,
        // Level on ground covered? The steadier player was caught less.
        tiebreak: [-a.busted, -b.busted],
        record: Math.round(Math.max(a.progress, b.progress) * 100),
        rows: [
          { tag: "P1", text: `caught moving ${a.busted}x`, value: `${Math.round(a.progress * 100)}%`, ratio: a.progress, color: C.p1 },
          { tag: "P2", text: `caught moving ${b.busted}x`, value: `${Math.round(b.progress * 100)}%`, ratio: b.progress, color: C.p2 },
        ],
      };
    },
  };
}

function createRunner() {
  return {
    progress: 0, busted: 0, moved: 0, motion: 0, flinchT: 0, flashT: 0,
    tracked: false, landmarks: null, meter: createMotionMeter(),
  };
}
