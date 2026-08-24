import { toCanvasPoint, dist, drawHammer, createFx, createShake } from "./utils.js";
import { C, drawDivider } from "./theme.js";
import { sfx } from "./audio.js";

const COLS = 4;                 // 2 columns per player
const ROWS = 3;
const MATCH_TIME = 30;
const UP_MS_START = 1000;
const UP_MS_FLOOR = 520;        // moles duck faster as the match goes on
const SPAWN_MS_START = 780;
const SPAWN_MS_FLOOR = 340;
const MAX_ACTIVE_PER_SIDE = 2;  // per side, so neither player can be starved
const GOLD_CHANCE = 0.16;

export function createWhackAMole() {
  return {
    id: "whackamole",
    title: "Whack-a-Mole",
    icon: "🔨",
    blurb: "Your hands become hammers. Flatten every mole on your half.",
    players: "2P VS",
    hint: "Both hands up — one player each side",
    mode: "hand",
    numHands: 4,                // two players × two hands

    init({ view }) {
      this.view = view;
      this.scores = [0, 0];
      this.hits = [0, 0];
      this.misses = [0, 0];
      this.timeLeft = MATCH_TIME;
      this.elapsed = 0;
      this.lastSpawn = [0, 0];
      this.hands = [[], []];
      this.fx = createFx();
      this.shake = createShake();
      this.over = false;
      this.holes = buildHoles(view);
    },

    onResize(view) {
      // Rebuild the grid for the new size, carrying each hole's state across
      // by index — the layout is deterministic, so indices stay meaningful.
      const previous = this.holes;
      this.view = view;
      this.holes = buildHoles(view);
      this.holes.forEach((hole, index) => {
        const old = previous[index];
        if (!old) return;
        hole.state = old.state;
        hole.stateT = old.stateT;
        hole.gold = old.gold;
        hole.upFor = old.upFor;
      });
    },

    onResults(hands) {
      this.hands = [[], []];
      for (const landmarks of hands) {
        const point = toCanvasPoint(landmarks[8], this.view);
        // Track the wrist too, so we can tell a swing from a hover.
        const wrist = toCanvasPoint(landmarks[0], this.view);
        point.swing = Math.max(0, Math.min(1, (point.y - wrist.y + 60) / 120));
        this.hands[point.x < this.view.width / 2 ? 0 : 1].push(point);
      }
    },

    upDuration() {
      return Math.max(UP_MS_FLOOR, UP_MS_START - this.elapsed * 16);
    },

    spawnInterval() {
      return Math.max(SPAWN_MS_FLOOR, SPAWN_MS_START - this.elapsed * 15);
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
      const midX = this.view.width / 2;

      // Each side spawns on its own clock and its own budget.
      for (const side of [0, 1]) {
        const mine = this.holes.filter((hole) => (hole.x < midX ? 0 : 1) === side);
        const active = mine.filter((hole) => hole.state === "up").length;
        if (now - this.lastSpawn[side] < this.spawnInterval() || active >= MAX_ACTIVE_PER_SIDE) continue;
        const empties = mine.filter((hole) => hole.state === "empty");
        if (empties.length === 0) continue;
        const hole = empties[Math.floor(Math.random() * empties.length)];
        hole.state = "up";
        hole.stateT = 0;
        hole.gold = Math.random() < GOLD_CHANCE;
        hole.upFor = this.upDuration() * (hole.gold ? 0.7 : 1);
        this.lastSpawn[side] = now;
      }

      for (const hole of this.holes) {
        hole.stateT += dt * 1000;
        const side = hole.x < midX ? 0 : 1;

        if (hole.state === "up") {
          for (const hand of this.hands[side]) {
            if (dist(hand, hole) > hole.r + 14) continue;
            const gain = hole.gold ? 3 : 1;
            hole.state = "hit";
            hole.stateT = 0;
            this.scores[side] += gain;
            this.hits[side] += 1;
            const color = hole.gold ? C.amber : side === 0 ? C.p1 : C.p2;
            this.fx.burst(hole.x, hole.y, color, hole.gold ? 16 : 10, hole.gold ? 250 : 180);
            this.fx.text(hole.x, hole.y - hole.r, `+${gain}`, color);
            this.shake.add(hole.gold ? 7 : 4);
            sfx.whack();
            break;
          }
          if (hole.state === "up" && hole.stateT > hole.upFor) {
            hole.state = "empty";
            hole.stateT = 0;
            this.misses[side] += 1;
          }
        } else if (hole.state === "hit" && hole.stateT > 240) {
          hole.state = "empty";
          hole.stateT = 0;
        }
      }
    },

    draw(ctx) {
      const { view } = this;
      const shaking = this.shake.apply(ctx);
      drawDivider(ctx, view, this.elapsed);

      for (const hole of this.holes) {
        const side = hole.x < view.width / 2 ? 0 : 1;
        const accent = side === 0 ? C.p1 : C.p2;

        // Socket
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(hole.x, hole.y + hole.r * 0.42, hole.r * 1.12, hole.r * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
        ctx.fill();
        ctx.strokeStyle = hole.state === "up" ? accent : "rgba(255,255,255,0.16)";
        ctx.lineWidth = hole.state === "up" ? 2 : 1.4;
        ctx.shadowColor = hole.state === "up" ? accent : "transparent";
        ctx.shadowBlur = hole.state === "up" ? 14 : 0;
        ctx.stroke();
        ctx.restore();

        if (hole.state === "up") {
          const pop = Math.min(1, hole.stateT / 130);
          const remaining = 1 - Math.min(1, hole.stateT / hole.upFor);
          const cy = hole.y - hole.r * 0.55 * pop;
          const body = hole.gold ? C.amber : "#c2915a";

          ctx.save();
          ctx.beginPath();
          ctx.arc(hole.x, cy, hole.r * 0.82, 0, Math.PI * 2);
          ctx.fillStyle = body;
          ctx.shadowColor = hole.gold ? C.amber : "#000";
          ctx.shadowBlur = hole.gold ? 22 : 10;
          ctx.fill();

          ctx.fillStyle = "#16100a";
          ctx.beginPath();
          ctx.arc(hole.x - hole.r * 0.28, cy - hole.r * 0.14, hole.r * 0.11, 0, Math.PI * 2);
          ctx.arc(hole.x + hole.r * 0.28, cy - hole.r * 0.14, hole.r * 0.11, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(hole.x, cy + hole.r * 0.2, hole.r * 0.16, 0, Math.PI);
          ctx.stroke();
          ctx.restore();

          // Countdown ring — you can see exactly how long you have.
          ctx.save();
          ctx.beginPath();
          ctx.arc(hole.x, cy, hole.r * 1.02, -Math.PI / 2, -Math.PI / 2 + remaining * Math.PI * 2);
          ctx.strokeStyle = remaining < 0.3 ? C.danger : accent;
          ctx.lineWidth = 2.5;
          ctx.lineCap = "round";
          ctx.shadowColor = ctx.strokeStyle;
          ctx.shadowBlur = 10;
          ctx.stroke();
          ctx.restore();
        } else if (hole.state === "hit") {
          const t = hole.stateT / 240;
          ctx.save();
          ctx.globalAlpha = 1 - t;
          ctx.translate(hole.x, hole.y - hole.r * (0.5 + t));
          ctx.scale(1 + t * 0.4, 1 + t * 0.4);
          ctx.font = `700 ${Math.floor(hole.r * 0.62)}px "Space Grotesk", sans-serif`;
          ctx.fillStyle = C.amber;
          ctx.textAlign = "center";
          ctx.shadowColor = C.amber;
          ctx.shadowBlur = 14;
          ctx.fillText("POW", 0, 0);
          ctx.restore();
        }
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
      const top = Math.max(this.scores[0], this.scores[1], 1);
      const pod = (side) => {
        const attempts = this.hits[side] + this.misses[side];
        return {
          value: this.scores[side],
          meta: attempts > 0 ? `${Math.round((this.hits[side] / attempts) * 100)}% ACCURACY` : "",
          ratio: this.scores[side] / top,
        };
      };
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
          { tag: "P1", text: `${this.hits[0]} hit · ${this.misses[0]} escaped`, value: `${a} pts`, ratio: a / top, color: C.p1 },
          { tag: "P2", text: `${this.hits[1]} hit · ${this.misses[1]} escaped`, value: `${b} pts`, ratio: b / top, color: C.p2 },
        ],
      };
    },
  };
}

function buildHoles(view) {
  const holes = [];
  const marginX = view.width * 0.09;
  const marginY = view.height * 0.2;
  const cellW = (view.width - marginX * 2) / COLS;
  const cellH = (view.height - marginY * 2) / ROWS;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      holes.push({
        x: marginX + cellW * (col + 0.5),
        y: marginY + cellH * (row + 0.5),
        r: Math.min(cellW, cellH) * 0.3,
        state: "empty",           // empty | up | hit
        stateT: 0,
        gold: false,
        upFor: UP_MS_START,
      });
    }
  }
  return holes;
}
