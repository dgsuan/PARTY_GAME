import { toCanvasPoint, dist, drawHammer } from "./utils.js";

const COLS = 4;
const ROWS = 3;
const MATCH_TIME = 30;
const MOLE_UP_MS = 950;
const SPAWN_EVERY_MS = 650;
const MAX_ACTIVE = 3;

export function createWhackAMole() {
  return {
    id: "whackamole",
    title: "Whack-a-Mole",
    icon: "🔨",
    blurb: "2 players · whack moles on your side before they duck",
    mode: "hand",
    numHands: 2,

    init({ canvas, ctx }) {
      this.canvas = canvas;
      this.ctx = ctx;
      this.scores = [0, 0];
      this.timeLeft = MATCH_TIME;
      this.lastSpawn = 0;
      this.hands = [[], []];
      this.over = false;

      this.holes = [];
      const marginX = canvas.width * 0.1;
      const marginY = canvas.height * 0.15;
      const cellW = (canvas.width - marginX * 2) / COLS;
      const cellH = (canvas.height - marginY * 2) / ROWS;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          this.holes.push({
            x: marginX + cellW * (c + 0.5),
            y: marginY + cellH * (r + 0.5),
            r: Math.min(cellW, cellH) * 0.3,
            state: "empty", // empty | up | hit
            stateT: 0,
          });
        }
      }
    },

    onResults(hands) {
      this.hands = [[], []];
      for (const lm of hands) {
        const point = toCanvasPoint(lm[8], this.canvas);
        this.hands[point.x < this.canvas.width / 2 ? 0 : 1].push(point);
      }
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
      const activeCount = this.holes.filter((h) => h.state === "up").length;
      if (now - this.lastSpawn > SPAWN_EVERY_MS && activeCount < MAX_ACTIVE) {
        const empties = this.holes.filter((h) => h.state === "empty");
        if (empties.length > 0) {
          const hole = empties[Math.floor(Math.random() * empties.length)];
          hole.state = "up";
          hole.stateT = 0;
          this.lastSpawn = now;
        }
      }

      for (const h of this.holes) {
        h.stateT += dt * 1000;
        if (h.state === "up") {
          const side = h.x < this.canvas.width / 2 ? 0 : 1;
          for (const tip of this.hands[side]) {
            if (dist(tip, h) < h.r + 12) {
              h.state = "hit";
              h.stateT = 0;
              this.scores[side] += 1;
              break;
            }
          }
          if (h.stateT > MOLE_UP_MS) {
            h.state = "empty";
            h.stateT = 0;
          }
        } else if (h.state === "hit" && h.stateT > 220) {
          h.state = "empty";
          h.stateT = 0;
        }
      }
    },

    draw(ctx) {
      const { canvas } = this;

      for (const h of this.holes) {
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(h.x, h.y + h.r * 0.4, h.r * 1.15, h.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fill();
        ctx.strokeStyle = "#3a2a18";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();

        if (h.state === "up") {
          const pop = Math.min(1, h.stateT / 120);
          ctx.save();
          ctx.beginPath();
          ctx.arc(h.x, h.y - h.r * 0.5 * pop, h.r * 0.85, 0, Math.PI * 2);
          ctx.fillStyle = "#b98a4e";
          ctx.shadowColor = "#ffb020";
          ctx.shadowBlur = 10;
          ctx.fill();
          // eyes
          ctx.fillStyle = "#1a1206";
          ctx.beginPath();
          ctx.arc(h.x - h.r * 0.3, h.y - h.r * 0.5 * pop - h.r * 0.15, h.r * 0.1, 0, Math.PI * 2);
          ctx.arc(h.x + h.r * 0.3, h.y - h.r * 0.5 * pop - h.r * 0.15, h.r * 0.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (h.state === "hit") {
          ctx.save();
          const t = h.stateT / 220;
          ctx.globalAlpha = 1 - t;
          ctx.font = `bold ${Math.floor(h.r * 0.9)}px monospace`;
          ctx.fillStyle = "#ffb020";
          ctx.textAlign = "center";
          ctx.fillText("POW!", h.x, h.y - h.r);
          ctx.restore();
        }
      }

      for (const [side, handPoints] of this.hands.entries()) {
        for (const tip of handPoints) {
          drawHammer(ctx, tip.x, tip.y, side === 0 ? "#35ff8f" : "#ff5fae");
        }
      }

      ctx.save();
      ctx.font = "bold 20px monospace";
      ctx.textBaseline = "top";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#35ff8f";
      ctx.shadowColor = "#35ff8f";
      ctx.textAlign = "left";
      ctx.fillText(`P1 ${this.scores[0]}`, 12, 10);
      ctx.fillStyle = "#ff5fae";
      ctx.shadowColor = "#ff5fae";
      ctx.textAlign = "right";
      ctx.fillText(`${this.scores[1]} P2  ${this.timeLeft.toFixed(0)}`, canvas.width - 12, 10);
      ctx.restore();
    },

    isOver() {
      return this.over;
    },

    getSummary() {
      return {
        title: "TIME'S UP",
        color: "#35ff8f",
        lines: [`P1 whacked ${this.scores[0]} moles`, `P2 whacked ${this.scores[1]} moles`],
      };
    },
  };
}
