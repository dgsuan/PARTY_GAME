import { toCanvasPoint, createFx, createShake, clamp } from "./utils.js";
import { C } from "./theme.js";
import { sfx } from "./audio.js";

/* ═══════════════════════════════════════════════════════════════════
   TUG OF WAR — pure exertion, no aiming at all.

   The rope moves toward whoever is waving harder. Because nothing here
   depends on hitting a target, tracking jitter genuinely does not
   matter — which makes it the most forgiving channel in the arcade and
   the natural short round between longer ones.
   ═══════════════════════════════════════════════════════════════════ */

const MATCH_TIME = 25;
const PULL_RATE = 0.042;     // rope travel per unit of net effort per second
const DECAY = 0.1;           // rope eases back to centre when both rest
const EFFORT_CAP = 9;        // stops one frantic hand dominating
const SMOOTH = 0.3;

export function createTugOfWar() {
  return {
    id: "tugofwar",
    title: "Tug of War",
    icon: "🪢",
    blurb: "No aiming. Wave your hands like mad and drag the rope home.",
    players: "2P VS",
    hint: "Both hands up — one player each side",
    tutorial: [
      "Wave your hands as fast as you can — speed is the only thing that counts.",
      "The rope moves toward whoever is working harder right now.",
      "Pull the knot all the way to your side to win.",
    ],
    mode: "hand",
    numHands: 4,

    init({ view, practice = false }) {
      this.view = view;
      this.practice = practice;
      this.drill = [0, 0];
      this.rope = 0;                 // -1 = P1 wins, +1 = P2 wins
      this.effort = [0, 0];
      this.peak = [0, 0];
      this.work = [0, 0];
      this.previous = [null, null];
      this.hands = [[], []];
      this.timeLeft = MATCH_TIME;
      this.elapsed = 0;
      this.fx = createFx();
      this.shake = createShake();
      this.over = false;
      this.winner = null;
    },

    onResize(view) { this.view = view; },

    onResults(hands) {
      const next = [[], []];
      for (const landmarks of hands) {
        const tip = toCanvasPoint(landmarks[8], this.view);
        const wrist = toCanvasPoint(landmarks[0], this.view);
        // Wrist decides the side: a waving arm crosses the midline often.
        next[wrist.x < this.view.width / 2 ? 0 : 1].push({ tip, wrist });
      }
      this.hands = next;
    },

    // Effort is hand travel per second, normalised by the viewport so it
    // means the same on any screen size.
    measureEffort(dt) {
      const scale = Math.max(1, this.view.width);
      for (const side of [0, 1]) {
        const hands = this.hands[side];
        let sum = 0;
        const previous = this.previous[side];
        if (previous) {
          for (let i = 0; i < hands.length; i++) {
            const before = previous[i];
            if (!before) continue;
            sum += Math.hypot(hands[i].tip.x - before.tip.x, hands[i].tip.y - before.tip.y);
          }
        }
        const raw = dt > 0 ? Math.min(EFFORT_CAP, (sum / scale) / dt * 4) : 0;
        this.effort[side] += (raw - this.effort[side]) * SMOOTH;
        this.peak[side] = Math.max(this.peak[side], this.effort[side]);
        this.work[side] += this.effort[side] * dt;
        this.previous[side] = hands.map((hand) => ({ tip: { ...hand.tip } }));
      }
    },

    update(dt) {
      if (this.over) return;
      this.elapsed += dt;
      this.fx.update(dt);
      this.shake.update(dt);
      this.measureEffort(dt);

      if (this.practice) {
        for (const side of [0, 1]) {
          if (this.effort[side] > 0.8) this.drill[side] = 1;
        }
        return;
      }

      this.timeLeft -= dt;

      // Net effort decides direction; the rope eases back when both rest.
      const net = this.effort[1] - this.effort[0];
      this.rope = clamp(this.rope + net * PULL_RATE * dt - this.rope * DECAY * dt, -1, 1);
      if (Math.abs(net) > 2) this.shake.add(Math.min(3, Math.abs(net) * 0.25));

      if (this.rope <= -1) { this.over = true; this.winner = 1; sfx.win(); }
      else if (this.rope >= 1) { this.over = true; this.winner = 2; sfx.win(); }
      else if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.over = true;
        this.winner = this.rope < 0 ? 1 : this.rope > 0 ? 2 : null;
      }
    },

    draw(ctx) {
      const { view } = this;
      const shaking = this.shake.apply(ctx);
      const midY = view.height * 0.5;
      const knotX = view.width * (0.5 + this.rope * 0.42);

      // Win zones
      for (const side of [0, 1]) {
        const accent = side === 0 ? C.p1 : C.p2;
        const zoneW = view.width * 0.08;
        const x = side === 0 ? 0 : view.width - zoneW;
        ctx.save();
        ctx.globalAlpha = 0.12 + (side === 0 ? Math.max(0, -this.rope) : Math.max(0, this.rope)) * 0.35;
        ctx.fillStyle = accent;
        ctx.fillRect(x, 0, zoneW, view.height);
        ctx.restore();
      }

      // Rope
      ctx.save();
      ctx.strokeStyle = "rgba(190, 170, 130, 0.85)";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(view.width * 0.02, midY);
      // A little slack that tightens as the contest heats up.
      const strain = Math.min(1, (this.effort[0] + this.effort[1]) / 6);
      const sag = (1 - strain) * 22;
      ctx.quadraticCurveTo((view.width * 0.02 + knotX) / 2, midY + sag, knotX, midY);
      ctx.quadraticCurveTo((view.width * 0.98 + knotX) / 2, midY + sag, view.width * 0.98, midY);
      ctx.stroke();
      ctx.restore();

      // Centre line and knot
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.setLineDash([8, 10]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(view.width / 2, view.height * 0.2);
      ctx.lineTo(view.width / 2, view.height * 0.8);
      ctx.stroke();
      ctx.restore();

      const leader = this.rope < -0.02 ? C.p1 : this.rope > 0.02 ? C.p2 : C.amber;
      ctx.save();
      ctx.translate(knotX, midY);
      ctx.rotate(this.elapsed * 2 * Math.sign(this.rope || 1));
      ctx.strokeStyle = leader;
      ctx.shadowColor = leader;
      ctx.shadowBlur = 24;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, 17, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Effort gauges
      for (const side of [0, 1]) {
        const accent = side === 0 ? C.p1 : C.p2;
        const level = Math.min(1, this.effort[side] / EFFORT_CAP);
        const w = view.width * 0.3;
        const x = side === 0 ? view.width * 0.06 : view.width * 0.64;
        const y = view.height * 0.78;
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.fillRect(x, y, w, 8);
        ctx.fillStyle = accent;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 14;
        const fill = w * level;
        ctx.fillRect(side === 0 ? x + w - fill : x, y, fill, 8);
        ctx.restore();
      }

      // Hands
      for (const [side, hands] of this.hands.entries()) {
        const accent = side === 0 ? C.p1 : C.p2;
        for (const hand of hands) {
          const heat = Math.min(1, this.effort[side] / EFFORT_CAP);
          ctx.save();
          ctx.translate(hand.tip.x, hand.tip.y);
          ctx.strokeStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 10 + heat * 26;
          ctx.lineWidth = 2 + heat * 3;
          ctx.beginPath();
          ctx.arc(0, 0, 15 + heat * 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      this.fx.draw(ctx);
      if (shaking) ctx.restore();
    },

    getDrill() {
      return {
        label: "WAVE YOUR HANDS",
        tip: "No target to hit — just move fast",
        target: 1,
        progress: this.drill,
        done: this.drill[0] >= 1 && this.drill[1] >= 1,
      };
    },

    getHud() {
      const pod = (side) => ({
        value: `${Math.round(Math.min(1, this.effort[side] / EFFORT_CAP) * 100)}`,
        meta: this.hands[side].length ? "EFFORT" : "NO HANDS",
        ratio: side === 0 ? Math.max(0, -this.rope) : Math.max(0, this.rope),
      });
      return {
        p1: pod(0),
        p2: pod(1),
        center: {
          value: Math.ceil(Math.max(0, this.timeLeft)),
          label: "TIME",
          ratio: this.timeLeft / MATCH_TIME,
          danger: this.timeLeft <= 5,
        },
      };
    },

    isOver() { return this.over; },

    getSummary() {
      const pulled = Math.abs(this.rope);
      return {
        title: this.winner ? `PLAYER ${this.winner} WINS` : "DEADLOCK",
        color: this.winner === 1 ? C.p1 : this.winner === 2 ? C.p2 : C.amber,
        winner: this.winner,
        // Level rope? Whoever put in more total work over the match.
        tiebreak: [this.work[0], this.work[1]],
        record: Math.round(Math.max(this.peak[0], this.peak[1]) * 10),
        rows: [
          { tag: "P1", text: `peak effort ${this.peak[0].toFixed(1)}`, value: `${Math.round(this.work[0])} work`, ratio: this.work[0] / Math.max(1, this.work[0] + this.work[1]), color: C.p1 },
          { tag: "P2", text: `peak effort ${this.peak[1].toFixed(1)}`, value: `${Math.round(this.work[1])} work`, ratio: this.work[1] / Math.max(1, this.work[0] + this.work[1]), color: C.p2 },
        ],
      };
    },
  };
}
