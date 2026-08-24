import { toCanvasPoint } from "./utils.js";

const COLS_PER_SIDE = 3;
const ROWS = 4;
const MAX_TIME = 60;

function buildGrid(canvas, side) {
  const blocks = [];
  const halfW = canvas.width / 2;
  const marginX = halfW * 0.12;
  const marginY = canvas.height * 0.12;
  const cellW = (halfW - marginX * 2) / COLS_PER_SIDE;
  const cellH = (canvas.height - marginY * 2) / ROWS;
  const offsetX = side === "left" ? 0 : halfW;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS_PER_SIDE; c++) {
      blocks.push({
        x: offsetX + marginX + cellW * c,
        y: marginY + cellH * r,
        w: cellW * 0.86,
        h: cellH * 0.8,
        broken: false,
        breakT: 0,
      });
    }
  }
  return blocks;
}

function hitTest(pt, b) {
  return pt.x > b.x && pt.x < b.x + b.w && pt.y > b.y && pt.y < b.y + b.h;
}

export function createIceBreaker() {
  return {
    id: "icebreaker",
    title: "Ice Breaker",
    icon: "🧊",
    blurb: "1v1 · hands become hammers · smash all your ice first",
    mode: "hand",
    numHands: 2,

    init({ canvas, ctx }) {
      this.canvas = canvas;
      this.ctx = ctx;
      this.blocksLeft = buildGrid(canvas, "left");
      this.blocksRight = buildGrid(canvas, "right");
      this.elapsed = 0;
      this.fingertipLeft = null;
      this.fingertipRight = null;
      this.over = false;
      this.winner = null; // 1, 2, or null (time-up tie logic decides)
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

    smash(blocks, tip) {
      if (!tip) return;
      for (const b of blocks) {
        if (!b.broken && hitTest(tip, b)) {
          b.broken = true;
          b.breakT = 0;
          break; // one block per frame per hand keeps it fair
        }
      }
    },

    update(dt) {
      if (this.over) return;
      this.elapsed += dt;

      this.smash(this.blocksLeft, this.fingertipLeft);
      this.smash(this.blocksRight, this.fingertipRight);
      for (const b of [...this.blocksLeft, ...this.blocksRight]) {
        if (b.broken) b.breakT += dt;
      }

      const leftDone = this.blocksLeft.every((b) => b.broken);
      const rightDone = this.blocksRight.every((b) => b.broken);

      if (leftDone || rightDone) {
        this.over = true;
        this.winner = leftDone && rightDone ? "draw" : leftDone ? 1 : 2;
      } else if (this.elapsed >= MAX_TIME) {
        this.over = true;
        const leftBroken = this.blocksLeft.filter((b) => b.broken).length;
        const rightBroken = this.blocksRight.filter((b) => b.broken).length;
        this.winner = leftBroken === rightBroken ? "draw" : leftBroken > rightBroken ? 1 : 2;
      }
    },

    drawBlock(ctx, b, color) {
      if (b.broken) {
        const t = Math.min(1, b.breakT / 0.3);
        if (t >= 1) return;
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x + b.w * t * 0.1, b.y + b.h * t * 0.1, b.w * (1 - t * 0.2), b.h * (1 - t * 0.2));
        ctx.restore();
        return;
      }
      ctx.save();
      ctx.fillStyle = "rgba(140, 220, 255, 0.18)";
      ctx.strokeStyle = "rgba(180, 235, 255, 0.85)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#8cdcff";
      ctx.shadowBlur = 6;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      // crack lines for texture
      ctx.beginPath();
      ctx.moveTo(b.x + b.w * 0.2, b.y);
      ctx.lineTo(b.x + b.w * 0.35, b.y + b.h * 0.5);
      ctx.lineTo(b.x + b.w * 0.15, b.y + b.h);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    },

    draw(ctx) {
      const { canvas } = this;
      const midX = canvas.width / 2;

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.setLineDash([10, 10]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(midX, 0);
      ctx.lineTo(midX, canvas.height);
      ctx.stroke();
      ctx.restore();

      for (const b of this.blocksLeft) this.drawBlock(ctx, b, "#35ff8f");
      for (const b of this.blocksRight) this.drawBlock(ctx, b, "#ff5fae");

      for (const [tip, color] of [[this.fingertipLeft, "#35ff8f"], [this.fingertipRight, "#ff5fae"]]) {
        if (!tip) continue;
        ctx.save();
        ctx.translate(tip.x, tip.y);
        ctx.rotate(-0.5);
        ctx.fillStyle = "#8a5a2b";
        ctx.fillRect(-4, -6, 8, 46);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.fillRect(-22, -30, 44, 26);
        ctx.restore();
      }

      const leftBroken = this.blocksLeft.filter((b) => b.broken).length;
      const rightBroken = this.blocksRight.filter((b) => b.broken).length;
      const total = this.blocksLeft.length;

      ctx.save();
      ctx.font = "bold 18px monospace";
      ctx.textBaseline = "top";
      ctx.shadowBlur = 8;
      ctx.fillStyle = "#35ff8f";
      ctx.shadowColor = "#35ff8f";
      ctx.textAlign = "left";
      ctx.fillText(`P1  ${leftBroken}/${total}`, 12, 10);
      ctx.fillStyle = "#ff5fae";
      ctx.shadowColor = "#ff5fae";
      ctx.textAlign = "right";
      ctx.fillText(`${rightBroken}/${total}  P2`, canvas.width - 12, 10);
      ctx.fillStyle = "#ffb020";
      ctx.shadowColor = "#ffb020";
      ctx.textAlign = "center";
      ctx.fillText(Math.max(0, MAX_TIME - this.elapsed).toFixed(0), canvas.width / 2, 10);
      ctx.restore();
    },

    isOver() {
      return this.over;
    },

    getSummary() {
      const leftBroken = this.blocksLeft.filter((b) => b.broken).length;
      const rightBroken = this.blocksRight.filter((b) => b.broken).length;
      let title, color;
      if (this.winner === 1) { title = "PLAYER 1 WINS"; color = "#35ff8f"; }
      else if (this.winner === 2) { title = "PLAYER 2 WINS"; color = "#ff5fae"; }
      else { title = "DRAW"; color = "#ffb020"; }
      return {
        title,
        color,
        lines: [`P1 broke ${leftBroken}/${this.blocksLeft.length}`, `P2 broke ${rightBroken}/${this.blocksRight.length}`],
      };
    },
  };
}
