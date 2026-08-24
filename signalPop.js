import { toCanvasPoint, dist, createFx, createShake, clamp } from "./utils.js";
import { C, drawDivider, drawBrackets } from "./theme.js";
import { sfx } from "./audio.js";

const BUBBLE_MIN_R = 20;
const BUBBLE_MAX_R = 38;
const SPAWN_START_MS = 620;
const SPAWN_FLOOR_MS = 280;     // spawn rate tightens as the clock runs down
const BOMB_CHANCE = 0.2;
const BOMB_PENALTY = 5;
const MATCH_TIME = 30;
const STREAK_FOR_X2 = 5;
const STREAK_FOR_X3 = 12;

export function createSignalPop() {
  return {
    id: "signalpop",
    title: "Signal Pop",
    icon: "🫧",
    blurb: "Pop rising signals, dodge the bombs. Streaks multiply your score.",
    players: "2P VS",
    hint: "One player each side — raise an index finger",
    mode: "hand",
    numHands: 2,

    init({ view }) {
      this.view = view;
      this.scores = [0, 0];
      this.streaks = [0, 0];
      this.best = [0, 0];
      this.timeLeft = MATCH_TIME;
      this.bubbles = [];
      this.tips = [null, null];
      this.lastSpawn = 0;
      this.elapsed = 0;
      this.fx = createFx();
      this.shake = createShake();
      this.over = false;
    },

    onResize(view) {
      // Keep bubbles inside the new bounds instead of stranding them offscreen.
      this.view = view;
      for (const bubble of this.bubbles) {
        bubble.x = clamp(bubble.x, bubble.r, view.width - bubble.r);
        bubble.y = Math.min(bubble.y, view.height + bubble.r);
      }
    },

    onResults(hands) {
      this.tips = [null, null];
      for (const landmarks of hands) {
        const point = toCanvasPoint(landmarks[8], this.view);
        const side = point.x < this.view.width / 2 ? 0 : 1;
        // First hand seen on a side owns that side for the frame.
        if (!this.tips[side]) this.tips[side] = point;
      }
    },

    multiplier(side) {
      const streak = this.streaks[side];
      return streak >= STREAK_FOR_X3 ? 3 : streak >= STREAK_FOR_X2 ? 2 : 1;
    },

    spawnBubble() {
      const r = BUBBLE_MIN_R + Math.random() * (BUBBLE_MAX_R - BUBBLE_MIN_R);
      const roll = Math.random();
      const type = roll < BOMB_CHANCE ? "bomb" : roll < BOMB_CHANCE + 0.14 ? "amber" : "signal";
      this.bubbles.push({
        x: r + Math.random() * (this.view.width - 2 * r),
        y: this.view.height + r,
        r,
        vy: 60 + Math.random() * 70 + this.elapsed * 1.6,
        wobble: Math.random() * Math.PI * 2,
        type,
        popped: false,
        popT: 0,
      });
    },

    update(dt) {
      if (this.over) return;
      this.elapsed += dt;
      this.timeLeft -= dt;
      this.fx.update(dt);
      this.shake.update(dt);

      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.over = true;
        return;
      }

      const now = performance.now();
      const interval = Math.max(SPAWN_FLOOR_MS, SPAWN_START_MS - this.elapsed * 11);
      if (now - this.lastSpawn > interval) {
        this.spawnBubble();
        this.lastSpawn = now;
      }

      for (const bubble of this.bubbles) {
        if (bubble.popped) {
          bubble.popT += dt;
          continue;
        }
        bubble.y -= bubble.vy * dt;
        bubble.wobble += dt * 2.4;

        const side = bubble.x < this.view.width / 2 ? 0 : 1;
        const tip = this.tips[side];
        if (!tip) continue;
        if (dist(tip, bubble) > bubble.r + 14) continue;

        bubble.popped = true;
        bubble.popT = 0;

        if (bubble.type === "bomb") {
          this.scores[side] = Math.max(0, this.scores[side] - BOMB_PENALTY);
          this.streaks[side] = 0;
          this.fx.burst(bubble.x, bubble.y, C.danger, 16, 240);
          this.fx.text(bubble.x, bubble.y - 18, `-${BOMB_PENALTY}`, C.danger);
          this.shake.add(11);
          sfx.bomb();
        } else {
          const base = bubble.type === "amber" ? 3 : 1;
          const gain = base * this.multiplier(side);
          this.scores[side] += gain;
          this.streaks[side] += 1;
          this.best[side] = Math.max(this.best[side], this.streaks[side]);
          const color = bubble.type === "amber" ? C.amber : side === 0 ? C.p1 : C.p2;
          this.fx.burst(bubble.x, bubble.y, color, 10);
          this.fx.text(bubble.x, bubble.y - 16, `+${gain}`, color);
          bubble.type === "amber" ? sfx.bonus() : sfx.pop(side);
        }
      }

      this.bubbles = this.bubbles.filter((b) => (b.popped ? b.popT < 0.3 : b.y + b.r > -20));
    },

    draw(ctx) {
      const { view } = this;
      const shaking = this.shake.apply(ctx);

      drawDivider(ctx, view, this.elapsed);

      for (const bubble of this.bubbles) {
        const color = bubble.type === "bomb" ? C.danger : bubble.type === "amber" ? C.amber : C.p1;
        ctx.save();
        if (bubble.popped) {
          const t = bubble.popT / 0.3;
          ctx.globalAlpha = 1 - t;
          ctx.strokeStyle = color;
          ctx.lineWidth = 3 * (1 - t) + 0.5;
          ctx.beginPath();
          ctx.arc(bubble.x, bubble.y, bubble.r * (1 + t * 0.9), 0, Math.PI * 2);
          ctx.stroke();
        } else if (bubble.type === "bomb") {
          const pulse = 1 + Math.sin(bubble.wobble * 3) * 0.05;
          ctx.translate(bubble.x, bubble.y);
          ctx.scale(pulse, pulse);
          ctx.beginPath();
          ctx.arc(0, 0, bubble.r * 0.78, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255, 77, 77, 0.16)";
          ctx.fill();
          ctx.strokeStyle = C.danger;
          ctx.lineWidth = 2.5;
          ctx.shadowColor = C.danger;
          ctx.shadowBlur = 18;
          ctx.stroke();
          const s = bubble.r * 0.32;
          ctx.beginPath();
          ctx.moveTo(-s, -s); ctx.lineTo(s, s);
          ctx.moveTo(s, -s); ctx.lineTo(-s, s);
          ctx.stroke();
        } else {
          const wob = Math.sin(bubble.wobble) * 2.5;
          ctx.translate(bubble.x + wob, bubble.y);
          ctx.beginPath();
          ctx.arc(0, 0, bubble.r, 0, Math.PI * 2);
          ctx.fillStyle = bubble.type === "amber" ? "rgba(255,194,71,0.10)" : "rgba(34,230,200,0.08)";
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.shadowColor = color;
          ctx.shadowBlur = 16;
          ctx.stroke();
          // inner highlight arc — reads as a bubble, not a flat ring
          ctx.beginPath();
          ctx.arc(0, 0, bubble.r * 0.62, Math.PI * 1.05, Math.PI * 1.55);
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.7;
          ctx.stroke();
        }
        ctx.restore();
      }

      this.fx.draw(ctx);

      // Cursors: a reticle rather than a plain dot, so it reads as a tool.
      for (const [side, tip] of this.tips.entries()) {
        if (!tip) continue;
        const color = side === 0 ? C.p1 : C.p2;
        ctx.save();
        ctx.translate(tip.x, tip.y);
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.rotate(this.elapsed * 1.6);
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          ctx.beginPath();
          ctx.moveTo(18, 0);
          ctx.lineTo(24, 0);
          ctx.stroke();
        }
        ctx.restore();

        if (this.multiplier(side) > 1) {
          ctx.save();
          ctx.font = '700 12px "JetBrains Mono", monospace';
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.shadowColor = color;
          ctx.shadowBlur = 10;
          ctx.fillText(`x${this.multiplier(side)}`, tip.x, tip.y - 24);
          ctx.restore();
        }
      }

      // Framing brackets tint with whoever is ahead.
      const leader = this.scores[0] === this.scores[1] ? null : this.scores[0] > this.scores[1] ? 0 : 1;
      if (leader !== null) {
        const half = view.width / 2;
        drawBrackets(ctx, leader === 0 ? 10 : half + 10, 74, half - 20, view.height - 96,
          leader === 0 ? C.p1 : C.p2, 20, 0.28);
      }

      if (shaking) ctx.restore();
    },

    getHud() {
      const top = Math.max(this.scores[0], this.scores[1], 1);
      const pod = (side) => ({
        value: this.scores[side],
        meta: this.streaks[side] >= STREAK_FOR_X2
          ? `STREAK ${this.streaks[side]} · x${this.multiplier(side)}`
          : this.streaks[side] > 0 ? `STREAK ${this.streaks[side]}` : "",
        ratio: this.scores[side] / top,
      });
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
      const [a, b] = this.scores;
      const title = a > b ? "PLAYER 1 WINS" : b > a ? "PLAYER 2 WINS" : "DRAW";
      const color = a > b ? C.p1 : b > a ? C.p2 : C.amber;
      const top = Math.max(a, b, 1);
      return {
        title,
        color,
        record: Math.max(a, b),
        rows: [
          { tag: "P1", text: `best streak ${this.best[0]}`, value: `${a} pts`, ratio: a / top, color: C.p1 },
          { tag: "P2", text: `best streak ${this.best[1]}`, value: `${b} pts`, ratio: b / top, color: C.p2 },
        ],
      };
    },
  };
}
