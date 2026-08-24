import { toCanvasPoint, drawHammer, createFx, createShake } from "./utils.js";
import { C, drawDivider } from "./theme.js";
import { sfx } from "./audio.js";

const COLS_PER_SIDE = 4;
const ROWS = 4;
const MAX_TIME = 45;
const REINFORCED_CHANCE = 0.28;   // thicker ice, two hits to clear
const HIT_COOLDOWN_S = 0.13;      // per block, so a hover isn't a machine gun

export function createIceBreaker() {
  return {
    id: "icebreaker",
    title: "Ice Breaker",
    icon: "🧊",
    blurb: "Hands become hammers. Shatter your whole wall before your rival.",
    players: "2P VS",
    hint: "Both hands up — one player each side",
    mode: "hand",
    numHands: 4,

    init({ view }) {
      this.view = view;
      // One shared layout, so both sides always face the same wall.
      this.layout = randomLayout();
      this.blocks = [buildGrid(view, 0, this.layout), buildGrid(view, 1, this.layout)];
      this.elapsed = 0;
      this.hands = [[], []];
      this.fx = createFx();
      this.shake = createShake();
      this.over = false;
      this.winner = null;
    },

    onResize(view) {
      const previous = this.blocks;
      this.view = view;
      this.blocks = [buildGrid(view, 0, this.layout), buildGrid(view, 1, this.layout)];
      // Geometry is rebuilt for the new size; damage carries over by index.
      for (const side of [0, 1]) {
        this.blocks[side].forEach((block, index) => {
          const old = previous[side][index];
          if (!old) return;
          block.hp = old.hp;
          block.broken = old.broken;
          block.breakT = old.breakT;
          block.flashT = old.flashT;
          block.cool = old.cool;
        });
      }
    },

    onResults(hands) {
      this.hands = [[], []];
      for (const landmarks of hands) {
        const point = toCanvasPoint(landmarks[8], this.view);
        const wrist = toCanvasPoint(landmarks[0], this.view);
        point.swing = Math.max(0, Math.min(1, (point.y - wrist.y + 60) / 120));
        this.hands[point.x < this.view.width / 2 ? 0 : 1].push(point);
      }
    },

    strike(side, hand) {
      for (const block of this.blocks[side]) {
        if (block.broken || block.cool > 0) continue;
        if (hand.x < block.x || hand.x > block.x + block.w) continue;
        if (hand.y < block.y || hand.y > block.y + block.h) continue;

        block.cool = HIT_COOLDOWN_S;
        block.hp -= 1;
        block.flashT = 0.16;
        const cx = block.x + block.w / 2;
        const cy = block.y + block.h / 2;

        if (block.hp <= 0) {
          block.broken = true;
          block.breakT = 0;
          this.fx.shards(cx, cy, C.ice, 12);
          this.fx.burst(cx, cy, side === 0 ? C.p1 : C.p2, 6, 130);
          this.shake.add(5);
          sfx.smash();
        } else {
          this.fx.shards(cx, cy, C.ice, 4);
          this.shake.add(2);
          sfx.smash();
        }
        break;   // one block per hand per strike keeps it fair
      }
    },

    update(dt) {
      if (this.over) return;
      this.elapsed += dt;
      this.fx.update(dt);
      this.shake.update(dt);

      for (const side of [0, 1]) {
        for (const block of this.blocks[side]) {
          if (block.broken) block.breakT += dt;
          if (block.flashT > 0) block.flashT -= dt;
          if (block.cool > 0) block.cool -= dt;
        }
        for (const hand of this.hands[side]) this.strike(side, hand);
      }

      const cleared = [this.remaining(0) === 0, this.remaining(1) === 0];
      if (cleared[0] || cleared[1]) {
        this.over = true;
        this.winner = cleared[0] && cleared[1] ? "draw" : cleared[0] ? 1 : 2;
      } else if (this.elapsed >= MAX_TIME) {
        this.over = true;
        const broken = [this.broken(0), this.broken(1)];
        this.winner = broken[0] === broken[1] ? "draw" : broken[0] > broken[1] ? 1 : 2;
      }
    },

    remaining(side) {
      return this.blocks[side].filter((block) => !block.broken).length;
    },

    broken(side) {
      return this.blocks[side].filter((block) => block.broken).length;
    },

    draw(ctx) {
      const { view } = this;
      const shaking = this.shake.apply(ctx);
      drawDivider(ctx, view, this.elapsed);

      for (const side of [0, 1]) {
        for (const block of this.blocks[side]) drawBlock(ctx, block, side === 0 ? C.p1 : C.p2);
      }

      this.fx.draw(ctx);

      for (const [side, hands] of this.hands.entries()) {
        for (const hand of hands) {
          drawHammer(ctx, hand.x, hand.y, side === 0 ? C.p1 : C.p2, hand.swing ?? 0);
        }
      }

      if (shaking) ctx.restore();
    },

    getHud() {
      const total = this.blocks[0].length;
      const pod = (side) => ({
        value: `${this.broken(side)}/${total}`,
        meta: `${this.remaining(side)} BLOCKS LEFT`,
        ratio: this.broken(side) / total,
      });
      const left = Math.max(0, MAX_TIME - this.elapsed);
      return {
        p1: pod(0),
        p2: pod(1),
        center: { value: Math.ceil(left), label: "TIME", ratio: left / MAX_TIME, danger: left <= 8 },
      };
    },

    isOver() {
      return this.over;
    },

    getSummary() {
      const total = this.blocks[0].length;
      const broken = [this.broken(0), this.broken(1)];
      const title = this.winner === 1 ? "PLAYER 1 WINS" : this.winner === 2 ? "PLAYER 2 WINS" : "DRAW";
      const color = this.winner === 1 ? C.p1 : this.winner === 2 ? C.p2 : C.amber;
      return {
        title,
        color,
        record: Math.max(broken[0], broken[1]),
        rows: [
          { tag: "P1", text: `${(broken[0] / Math.max(this.elapsed, 0.1)).toFixed(1)} blocks/sec`, value: `${broken[0]}/${total}`, ratio: broken[0] / total, color: C.p1 },
          { tag: "P2", text: `${(broken[1] / Math.max(this.elapsed, 0.1)).toFixed(1)} blocks/sec`, value: `${broken[1]}/${total}`, ratio: broken[1] / total, color: C.p2 },
        ],
      };
    },
  };
}

// Which cells are reinforced is decided once and mirrored to both sides, so
// the two players face an identical wall.
function randomLayout() {
  return Array.from({ length: COLS_PER_SIDE * ROWS }, () => (Math.random() < REINFORCED_CHANCE ? 2 : 1));
}

function buildGrid(view, side, layout) {
  const blocks = [];
  const halfW = view.width / 2;
  const marginX = halfW * 0.1;
  const marginY = view.height * 0.16;
  const cellW = (halfW - marginX * 2) / COLS_PER_SIDE;
  const cellH = (view.height - marginY * 2) / ROWS;
  const offsetX = side === 0 ? 0 : halfW;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS_PER_SIDE; col++) {
      const index = row * COLS_PER_SIDE + col;
      const maxHp = layout[index];
      blocks.push({
        x: offsetX + marginX + cellW * col,
        y: marginY + cellH * row,
        w: cellW * 0.88,
        h: cellH * 0.82,
        maxHp,
        hp: maxHp,
        broken: false,
        breakT: 0,
        flashT: 0,
        cool: 0,
      });
    }
  }
  return blocks;
}

function drawBlock(ctx, block, accent) {
  if (block.broken) {
    const t = Math.min(1, block.breakT / 0.3);
    if (t >= 1) return;
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(
      block.x + block.w * t * 0.12, block.y + block.h * t * 0.12,
      block.w * (1 - t * 0.24), block.h * (1 - t * 0.24),
    );
    ctx.restore();
    return;
  }

  const reinforced = block.maxHp > 1;
  const damaged = block.hp < block.maxHp;

  ctx.save();
  ctx.fillStyle = reinforced ? "rgba(127, 216, 255, 0.26)" : "rgba(127, 216, 255, 0.14)";
  ctx.strokeStyle = reinforced ? "rgba(200, 240, 255, 0.95)" : "rgba(170, 230, 255, 0.75)";
  ctx.lineWidth = reinforced ? 2.5 : 1.6;
  ctx.shadowColor = C.ice;
  ctx.shadowBlur = 8;
  ctx.fillRect(block.x, block.y, block.w, block.h);
  ctx.strokeRect(block.x, block.y, block.w, block.h);

  // Facet lines give the ice some body.
  ctx.beginPath();
  ctx.moveTo(block.x + block.w * 0.22, block.y);
  ctx.lineTo(block.x + block.w * 0.4, block.y + block.h * 0.52);
  ctx.lineTo(block.x + block.w * 0.16, block.y + block.h);
  ctx.moveTo(block.x + block.w, block.y + block.h * 0.28);
  ctx.lineTo(block.x + block.w * 0.62, block.y + block.h * 0.6);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;
  ctx.shadowBlur = 0;
  ctx.stroke();

  // A cracked block shows it has taken a hit.
  if (damaged) {
    ctx.beginPath();
    ctx.moveTo(block.x + block.w * 0.1, block.y + block.h * 0.2);
    ctx.lineTo(block.x + block.w * 0.55, block.y + block.h * 0.42);
    ctx.lineTo(block.x + block.w * 0.3, block.y + block.h * 0.7);
    ctx.lineTo(block.x + block.w * 0.85, block.y + block.h * 0.9);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  if (block.flashT > 0) {
    ctx.globalAlpha = block.flashT / 0.16;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(block.x, block.y, block.w, block.h);
  }
  ctx.restore();
}
