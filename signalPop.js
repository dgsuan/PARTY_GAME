import { toCanvasPoint, dist } from "./utils.js";

const BUBBLE_MIN_R = 20;
const BUBBLE_MAX_R = 38;
const SPAWN_EVERY_MS = 550;
const BOMB_CHANCE = 0.22;
const BOMB_PENALTY = 5;
const MATCH_TIME = 30;

export function createSignalPop() {
  return {
    id: "signalpop",
    title: "Signal Pop",
    icon: "🫧",
    blurb: "1v1 · pop signals, dodge bombs, most points wins",
    mode: "hand",
    numHands: 2,

    init({ canvas, ctx }) {
      this.canvas = canvas;
      this.ctx = ctx;
      this.score1 = 0;
      this.score2 = 0;
      this.timeLeft = MATCH_TIME;
      this.bubbles = [];
      this.lastSpawn = 0;
      this.fingertipLeft = null;
      this.fingertipRight = null;
      this.over = false;
    },

    onResults(hands) {
      this.fingertipLeft = null;
      this.fingertipRight = null;
      for (const lm of hands) {
        const p = toCanvasPoint(lm[8], this.canvas);
        if (p.x < this.canvas.width / 2) this.fingertipLeft = p;
        else this.fingertipRight = p;
      }
    },

    spawnBubble() {
      const r = BUBBLE_MIN_R + Math.random() * (BUBBLE_MAX_R - BUBBLE_MIN_R);
      const isBomb = Math.random() < BOMB_CHANCE;
      this.bubbles.push({
        x: r + Math.random() * (this.canvas.width - 2 * r),
        y: this.canvas.height + r,
        r,
        vy: 55 + Math.random() * 65,
        type: isBomb ? "bomb" : Math.random() < 0.15 ? "amber" : "signal",
        popped: false,
        popT: 0,
      });
    },

    update(dt) {
      if (this.over) return;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.over = true;
        return;
      }

      const now = performance.now();
      if (now - this.lastSpawn > SPAWN_EVERY_MS) {
        this.spawnBubble();
        this.lastSpawn = now;
      }

      for (const b of this.bubbles) {
        if (b.popped) {
          b.popT += dt;
          continue;
        }
        b.y -= b.vy * dt;
        const side = b.x < this.canvas.width / 2 ? "left" : "right";
        const fingertip = side === "left" ? this.fingertipLeft : this.fingertipRight;
        if (!fingertip) continue;
        if (dist(fingertip, b) < b.r + 14) {
          b.popped = true;
          b.popT = 0;
          const delta = b.type === "bomb" ? -BOMB_PENALTY : b.type === "amber" ? 3 : 1;
          if (side === "left") this.score1 += delta;
          else this.score2 += delta;
        }
      }
      this.bubbles = this.bubbles.filter((b) => (b.popped ? b.popT < 0.28 : b.y + b.r > -20));
    },

    draw(ctx) {
      const { canvas } = this;
      const midX = canvas.width / 2;

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, canvas.height);
      ctx.stroke();
      ctx.restore();

      const colorFor = (t) => (t === "bomb" ? "#ff3b3b" : t === "amber" ? "#ffb020" : "#35ff8f");
      for (const b of this.bubbles) {
        ctx.save();
        if (b.popped) {
          const t = b.popT / 0.28;
          ctx.globalAlpha = 1 - t;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r * (1 + t * 0.8), 0, Math.PI * 2);
          ctx.strokeStyle = colorFor(b.type);
          ctx.lineWidth = 3;
          ctx.stroke();
        } else if (b.type === "bomb") {
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r * 0.8, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,59,59,0.15)";
          ctx.fill();
          ctx.strokeStyle = "#ff3b3b";
          ctx.lineWidth = 2.5;
          ctx.shadowColor = "#ff3b3b";
          ctx.shadowBlur = 14;
          ctx.stroke();
          const s = b.r * 0.35;
          ctx.beginPath();
          ctx.moveTo(b.x - s, b.y - s); ctx.lineTo(b.x + s, b.y + s);
          ctx.moveTo(b.x + s, b.y - s); ctx.lineTo(b.x - s, b.y + s);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.strokeStyle = colorFor(b.type);
          ctx.lineWidth = 2.5;
          ctx.shadowColor = ctx.strokeStyle;
          ctx.shadowBlur = 12;
          ctx.stroke();
        }
        ctx.restore();
      }

      for (const [pt, color] of [[this.fingertipLeft, "#35ff8f"], [this.fingertipRight, "#ff5fae"]]) {
        if (!pt) continue;
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.font = "bold 20px monospace";
      ctx.textBaseline = "top";
      ctx.shadowBlur = 8;

      ctx.fillStyle = "#35ff8f";
      ctx.shadowColor = "#35ff8f";
      ctx.textAlign = "left";
      ctx.fillText(`P1  ${this.score1}`, 12, 10);

      ctx.fillStyle = "#ff5fae";
      ctx.shadowColor = "#ff5fae";
      ctx.textAlign = "right";
      ctx.fillText(`${this.score2}  P2`, canvas.width - 12, 10);

      ctx.fillStyle = "#ffb020";
      ctx.shadowColor = "#ffb020";
      ctx.textAlign = "center";
      ctx.fillText(this.timeLeft.toFixed(0), canvas.width / 2, 10);
      ctx.restore();
    },

    isOver() {
      return this.over;
    },

    getSummary() {
      let title, color;
      if (this.score1 > this.score2) { title = "PLAYER 1 WINS"; color = "#35ff8f"; }
      else if (this.score2 > this.score1) { title = "PLAYER 2 WINS"; color = "#ff5fae"; }
      else { title = "DRAW"; color = "#ffb020"; }
      return {
        title,
        color,
        lines: [`P1: ${this.score1} pts`, `P2: ${this.score2} pts`],
      };
    },
  };
}
