import { createFx, clamp } from "./utils.js";
import { C } from "./theme.js";
import { sfx } from "./audio.js";
import { POSES, getPoints, bodyUnit, createPoseTracker, drawSkeleton, drawStickFigure } from "./poseKit.js";

/* ═══════════════════════════════════════════════════════════════════
   ECHO — the only channel that tests memory rather than reflexes.

   A sequence of poses plays back; both players then perform it from
   memory, at the same time. Each round adds one more. Get it wrong and
   you are out; the last player standing wins, and if both fall on the
   same round the deeper run takes it.
   ═══════════════════════════════════════════════════════════════════ */

const SHOW_TIME = 0.85;       // how long each pose is displayed
const SHOW_GAP = 0.2;
const HOLD_TIME = 0.3;        // hold to register a pose
const ANSWER_TIME = 6;        // seconds allowed per pose when answering
const START_LENGTH = 2;
const MAX_ROUNDS = 12;

export function createEcho() {
  return {
    id: "echo",
    title: "Echo",
    icon: "🧠",
    blurb: "Watch the sequence, then repeat it from memory. It grows.",
    players: "2P VS",
    hint: "Both players step back — full body in frame, one each side",
    tutorial: [
      "Watch the sequence of poses play out — memorise the order.",
      "When it says REPEAT, perform them yourself in the same order.",
      "One extra pose every round. Last player standing wins.",
    ],
    mode: "pose",
    numPoses: 2,

    init({ view, practice = false }) {
      this.view = view;
      this.practice = practice;
      this.drill = [0, 0];
      this.tracker = createPoseTracker();
      this.players = [createMind(), createMind()];
      this.round = 0;
      this.sequence = [];
      this.phase = "show";       // show | answer | reveal
      this.showIndex = 0;
      this.showT = 0;
      this.answerT = 0;
      this.revealT = 0;
      this.elapsed = 0;
      this.fx = createFx();
      this.over = false;
      this.startRound();
    },

    onResize(view) { this.view = view; },

    onResults(poses) {
      const assigned = this.tracker.assign(poses);
      this.players[0].landmarks = assigned[0];
      this.players[1].landmarks = assigned[1];
    },

    startRound() {
      this.round += 1;
      const length = this.practice ? 1 : START_LENGTH + this.round - 1;
      this.sequence = [];
      let previous = null;
      for (let i = 0; i < length; i++) {
        // Never repeat back-to-back: an unbroken run is ambiguous to watch.
        const next = POSES.filter((p) => p !== previous)[Math.floor(Math.random() * (POSES.length - (previous ? 1 : 0)))];
        this.sequence.push(next);
        previous = next;
      }
      this.phase = "show";
      this.showIndex = 0;
      this.showT = 0;
      for (const player of this.players) {
        if (!player.out) { player.step = 0; player.holdT = 0; player.lastMatch = null; }
      }
    },

    livePlayers() {
      return this.players.filter((player) => !player.out);
    },

    update(dt) {
      if (this.over) return;
      this.elapsed += dt;
      this.fx.update(dt);

      for (const [index, player] of this.players.entries()) {
        const points = getPoints(player.landmarks, this.view);
        player.tracked = !!points;
        player.points = points;
        player.unit = points ? bodyUnit(points) : 0;
        if (player.flashT > 0) player.flashT -= dt;
        if (player.winT > 0) player.winT -= dt;
      }

      if (this.phase === "show") {
        this.showT += dt;
        if (this.showT >= SHOW_TIME + SHOW_GAP) {
          this.showT = 0;
          this.showIndex += 1;
          if (this.showIndex >= this.sequence.length) {
            this.phase = "answer";
            this.answerT = ANSWER_TIME;
            sfx.go();
          } else {
            sfx.count();
          }
        }
        return;
      }

      if (this.phase === "reveal") {
        this.revealT -= dt;
        if (this.revealT <= 0) {
          if (!this.practice && (this.livePlayers().length <= 1 || this.round >= MAX_ROUNDS)) {
            this.over = true;
            return;
          }
          this.startRound();
        }
        return;
      }

      // Answering
      this.answerT -= dt;
      const expired = this.answerT <= 0;

      for (const [index, player] of this.players.entries()) {
        if (player.out || player.step >= this.sequence.length) continue;

        const want = this.sequence[player.step];
        // Poses are not mutually exclusive (hands-on-head also reads as
        // arms-up), so ask "does this match the target?" rather than
        // "which pose is this?".
        const hits = player.points ? want.check(player.points, player.unit) : false;
        const wrong = !hits && player.points &&
          POSES.some((pose) => pose !== want && pose.check(player.points, player.unit));

        if (hits) {
          player.holdT += dt;
          if (player.holdT >= HOLD_TIME) {
            player.holdT = 0;
            player.step += 1;
            player.depth = Math.max(player.depth, player.step);
            player.winT = 0.3;
            sfx.match();
            if (this.practice) this.drill[index] = 1;
            if (player.step >= this.sequence.length) {
              player.cleared += 1;
              this.fx.text(this.laneX(index), this.view.height * 0.4, "ECHOED", index === 0 ? C.p1 : C.p2);
            } else {
              this.answerT = ANSWER_TIME;   // fresh budget for the next pose
            }
          }
        } else if (wrong && !this.practice) {
          // A confidently wrong pose ends the round for that player.
          player.holdT += dt;
          if (player.holdT >= HOLD_TIME * 1.6) {
            this.fail(player, index);
          }
        } else {
          player.holdT = 0;
        }
      }

      const everyoneDone = this.livePlayers().every((player) => player.step >= this.sequence.length);
      if (expired && !this.practice) {
        for (const [index, player] of this.players.entries()) {
          if (!player.out && player.step < this.sequence.length) this.fail(player, index);
        }
      }
      if (everyoneDone || expired) {
        this.phase = "reveal";
        this.revealT = 1.3;
        if (this.practice && this.drill[0] && this.drill[1]) this.revealT = 0.1;
      }
    },

    fail(player, index) {
      player.out = true;
      player.flashT = 0.5;
      sfx.fail();
      this.fx.text(this.laneX(index), this.view.height * 0.4, "BROKEN", C.danger);
    },

    laneX(index) { return this.view.width * (index === 0 ? 0.25 : 0.75); },

    draw(ctx) {
      const { view } = this;
      const half = view.width / 2;

      // The sequence plays in the middle during SHOW.
      if (this.phase === "show") {
        const pose = this.sequence[this.showIndex];
        const visible = this.showT < SHOW_TIME;
        if (pose && visible) {
          const scale = Math.min(1, this.showT / 0.12);
          drawStickFigure(ctx, half, view.height * 0.5, 40 * (0.85 + scale * 0.15), pose.arms, C.amber, 26);
          ctx.save();
          ctx.font = '700 16px "Space Grotesk", sans-serif';
          ctx.textAlign = "center";
          ctx.fillStyle = C.amber;
          ctx.shadowColor = C.amber;
          ctx.shadowBlur = 14;
          ctx.fillText(pose.label, half, view.height * 0.72);
          ctx.restore();
        }
        ctx.save();
        ctx.font = '700 12px "JetBrains Mono", monospace';
        ctx.textAlign = "center";
        ctx.fillStyle = C.muted;
        ctx.fillText(`WATCH — ${this.showIndex + 1}/${this.sequence.length}`, half, view.height * 0.16);
        ctx.restore();

        // Progress pips for the sequence.
        const pipY = view.height * 0.84;
        const spacing = 18;
        const startX = half - ((this.sequence.length - 1) * spacing) / 2;
        for (let i = 0; i < this.sequence.length; i++) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(startX + i * spacing, pipY, 5, 0, Math.PI * 2);
          ctx.fillStyle = i <= this.showIndex ? C.amber : "rgba(255,255,255,0.18)";
          ctx.fill();
          ctx.restore();
        }
        return;
      }

      for (const [index, player] of this.players.entries()) {
        const originX = index === 0 ? 0 : half;
        const accent = index === 0 ? C.p1 : C.p2;

        if (player.landmarks) {
          drawSkeleton(ctx, player.landmarks, this.view, {
            color: player.out ? "rgba(120,120,140,0.5)" : player.holdT > 0 ? C.p1 : accent,
            glow: 10,
          });
        }

        if (player.out) {
          ctx.save();
          ctx.globalAlpha = 0.4;
          ctx.fillStyle = "#000";
          ctx.fillRect(originX, 0, half, view.height);
          ctx.font = '700 20px "Space Grotesk", sans-serif';
          ctx.textAlign = "center";
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = C.danger;
          ctx.fillText("OUT", originX + half / 2, view.height * 0.5);
          ctx.restore();
          continue;
        }

        // What this player must produce next.
        const want = this.sequence[Math.min(player.step, this.sequence.length - 1)];
        const done = player.step >= this.sequence.length;
        ctx.save();
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.textAlign = "center";
        ctx.fillStyle = done ? C.p1 : C.muted;
        ctx.fillText(done ? "SEQUENCE COMPLETE" : `POSE ${player.step + 1} OF ${this.sequence.length}`,
          originX + half / 2, view.height * 0.14);
        ctx.restore();

        // Pips showing how far through the sequence they are.
        const spacing = 16;
        const startX = originX + half / 2 - ((this.sequence.length - 1) * spacing) / 2;
        for (let i = 0; i < this.sequence.length; i++) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(startX + i * spacing, view.height * 0.2, 5, 0, Math.PI * 2);
          ctx.fillStyle = i < player.step ? accent : "rgba(255,255,255,0.18)";
          if (i < player.step) { ctx.shadowColor = accent; ctx.shadowBlur = 10; }
          ctx.fill();
          ctx.restore();
        }

        if (!done && player.holdT > 0) {
          const hold = clamp(player.holdT / HOLD_TIME, 0, 1);
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.16)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(originX + half / 2 - 40, view.height * 0.9);
          ctx.lineTo(originX + half / 2 + 40, view.height * 0.9);
          ctx.stroke();
          ctx.strokeStyle = C.p1;
          ctx.shadowColor = C.p1;
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(originX + half / 2 - 40, view.height * 0.9);
          ctx.lineTo(originX + half / 2 - 40 + 80 * hold, view.height * 0.9);
          ctx.stroke();
          ctx.restore();
        }

        if (!player.tracked) {
          ctx.save();
          ctx.font = '700 12px "JetBrains Mono", monospace';
          ctx.textAlign = "center";
          ctx.fillStyle = C.amber;
          ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 240) * 0.4;
          ctx.fillText(`PLAYER ${index + 1} — STEP INTO FRAME`, originX + half / 2, view.height * 0.62);
          ctx.restore();
        }
        if (player.flashT > 0) {
          ctx.save();
          ctx.globalAlpha = (player.flashT / 0.5) * 0.5;
          ctx.fillStyle = C.danger;
          ctx.fillRect(originX, 0, half, view.height);
          ctx.restore();
        }
      }

      if (this.phase === "answer") {
        ctx.save();
        ctx.font = '700 22px "Space Grotesk", sans-serif';
        ctx.textAlign = "center";
        ctx.fillStyle = C.p1;
        ctx.shadowColor = C.p1;
        ctx.shadowBlur = 18;
        ctx.fillText("REPEAT", half, view.height * 0.5);
        ctx.restore();
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
        label: "ECHO 1 POSE EACH",
        tip: "Watch the figure, then copy it when it says REPEAT",
        target: 1,
        progress: this.drill,
        done: this.drill[0] >= 1 && this.drill[1] >= 1,
      };
    },

    getHud() {
      const pod = (side) => {
        const player = this.players[side];
        return {
          value: player.cleared,
          meta: player.out ? "OUT" : player.tracked ? `DEPTH ${player.depth}` : "NO SUBJECT",
          ratio: clamp(player.cleared / Math.max(1, this.round), 0, 1),
        };
      };
      return {
        p1: pod(0),
        p2: pod(1),
        center: {
          value: this.sequence.length,
          label: this.phase === "show" ? "WATCH" : this.phase === "answer" ? "REPEAT" : `ROUND ${this.round}`,
          ratio: this.phase === "answer" ? clamp(this.answerT / ANSWER_TIME, 0, 1) : 1,
          danger: this.phase === "answer" && this.answerT < 2,
        },
      };
    },

    isOver() { return this.over; },

    getSummary() {
      const [a, b] = this.players;
      let winner = null;
      if (a.out !== b.out) winner = a.out ? 2 : 1;
      else if (a.cleared !== b.cleared) winner = a.cleared > b.cleared ? 1 : 2;
      return {
        title: winner ? `PLAYER ${winner} WINS` : "DRAW",
        color: winner === 1 ? C.p1 : winner === 2 ? C.p2 : C.amber,
        winner,
        // Level on sequences? Whoever got deeper into the last one.
        tiebreak: [a.depth, b.depth],
        record: Math.max(a.cleared, b.cleared),
        rows: [
          { tag: "P1", text: a.out ? `broke on round ${this.round}` : "still standing", value: `${a.cleared} echoed`, ratio: a.cleared / Math.max(1, this.round), color: C.p1 },
          { tag: "P2", text: b.out ? `broke on round ${this.round}` : "still standing", value: `${b.cleared} echoed`, ratio: b.cleared / Math.max(1, this.round), color: C.p2 },
        ],
      };
    },
  };
}

function createMind() {
  return {
    step: 0, cleared: 0, depth: 0, holdT: 0, out: false,
    flashT: 0, winT: 0, tracked: false, landmarks: null, points: null, unit: 0,
  };
}
