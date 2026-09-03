import { toCanvasPoint, palmCenter, dist, drawHammer, createFx, createShake } from "./utils.js";
import { C, drawDivider } from "./theme.js";
import { sfx } from "./audio.js";
import { BASE_SPAWN_INTERVAL } from "./balance.js";

/* ── CONFIG ──────────────────────────────────────────────────────────
   BASE_SPAWN_INTERVAL is shared with Signal Pop (see balance.js).
   All time-based difficulty ramping has been removed: the game now gets
   harder only in response to what the players do.
   ─────────────────────────────────────────────────────────────────── */
const COLS = 4;                   // 2 columns per player
const ROWS = 3;
const MATCH_TIME = 30;
const UP_MS = 850;                // was 1000 ramping to 520  (-15% visible)
const MAX_ACTIVE_PER_SIDE = 2;    // per side, so neither player is starved
const GOLD_CHANCE = 0.16;
const HIT_PAD = 14;               // reach added to the mole radius
const HITBOX_SCALE = 0.95;        // -5% hitbox; the mole is drawn to match

// Miss penalty: letting a mole escape makes YOUR side spawn faster for the
// next few moles. Three clean hits in a row cancels it.
const MISS_SPAWN_BOOST = 1.2;     // spawn rate x1.2 while penalised
const MISS_PENALTY_MOLES = 3;     // moles the penalty applies to
const HITS_TO_CLEAR = 3;          // consecutive hits that cancel it

export function createWhackAMole() {
  return {
    id: "whackamole",
    title: "Whack-a-Mole",
    icon: "🔨",
    blurb: "Your hands become hammers. Flatten every mole on your half.",
    players: "2P VS",
    hint: "Both hands up — one player each side",
    tutorial: [
      "Both hands up — they become hammers on your half.",
      "Smash moles before the ring around them runs out.",
      "Gold moles are worth 3 but duck away faster.",
    ],
    mode: "hand",
    numHands: 4,                // two players × two hands

    init({ view, practice = false }) {
      this.view = view;
      this.practice = practice;
      this.drill = [0, 0];
      this.scores = [0, 0];
      this.hits = [0, 0];
      this.misses = [0, 0];
      this.timeLeft = MATCH_TIME;
      this.elapsed = 0;
      this.lastSpawn = [0, 0];     // measured against this.elapsed, not wall time
      this.penalty = [0, 0];       // moles still affected by a miss
      this.hitStreak = [0, 0];     // consecutive hits, clears the penalty
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
        // The palm, not a fingertip: players close their hands to swing, and
        // a curled index finger takes its landmark with it.
        const point = toCanvasPoint(palmCenter(landmarks), this.view);
        // Track the wrist too, so we can tell a swing from a hover. The
        // palm sits about half as far from the wrist as a fingertip did, so
        // the wind-up range is scaled to match.
        const wrist = toCanvasPoint(landmarks[0], this.view);
        point.swing = Math.max(0, Math.min(1, (point.y - wrist.y + 30) / 60));
        this.hands[point.x < this.view.width / 2 ? 0 : 1].push(point);
      }
    },

    upDuration() {
      if (this.practice) return 2600;      // plenty of time to find the swing
      return UP_MS;
    },

    // Flat base rate, sped up only for a side that just missed one.
    spawnInterval(side) {
      if (this.practice) return 0.7;
      return BASE_SPAWN_INTERVAL / (this.penalty[side] > 0 ? MISS_SPAWN_BOOST : 1);
    },

    update(dt) {
      if (this.over) return;
      this.elapsed += dt;
      this.fx.update(dt);
      this.shake.update(dt);
      if (!this.practice) this.timeLeft -= dt;

      if (!this.practice && this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.over = true;
        return;
      }

      const midX = this.view.width / 2;

      // Each side spawns on its own clock and its own budget.
      for (const side of [0, 1]) {
        const mine = this.holes.filter((hole) => (hole.x < midX ? 0 : 1) === side);
        const active = mine.filter((hole) => hole.state === "up").length;
        if (this.elapsed - this.lastSpawn[side] < this.spawnInterval(side) || active >= MAX_ACTIVE_PER_SIDE) continue;
        const empties = mine.filter((hole) => hole.state === "empty");
        if (empties.length === 0) continue;
        const hole = empties[Math.floor(Math.random() * empties.length)];
        hole.state = "up";
        hole.stateT = 0;
        hole.gold = !this.practice && Math.random() < GOLD_CHANCE;
        hole.upFor = this.upDuration() * (hole.gold ? 0.7 : 1);
        this.lastSpawn[side] = this.elapsed;
        if (this.penalty[side] > 0) this.penalty[side] -= 1;
      }

      for (const hole of this.holes) {
        hole.stateT += dt * 1000;
        const side = hole.x < midX ? 0 : 1;

        if (hole.state === "up") {
          for (const hand of this.hands[side]) {
            if (dist(hand, hole) > (hole.r + HIT_PAD) * HITBOX_SCALE) continue;
            const gain = hole.gold ? 3 : 1;
            hole.state = "hit";
            hole.stateT = 0;
            this.scores[side] += gain;
            this.hits[side] += 1;
            this.drill[side] += 1;
            this.hitStreak[side] += 1;
            if (this.hitStreak[side] >= HITS_TO_CLEAR) {
              this.penalty[side] = 0;      // three clean hits pays off the debt
              this.hitStreak[side] = 0;
            }
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
            this.penalty[side] = MISS_PENALTY_MOLES;
            this.hitStreak[side] = 0;
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

        drawBurrow(ctx, hole, hole.state === "up" ? accent : null);

        if (hole.state === "up") {
          // Overshoot then settle, so the mole visibly springs out.
          const raw = Math.min(1, hole.stateT / 190);
          const pop = raw < 1 ? 1.12 * Math.sin(raw * Math.PI * 0.5) - 0.12 * raw : 1;
          const remaining = 1 - Math.min(1, hole.stateT / hole.upFor);
          const cy = hole.y - hole.r * 0.62 * pop;

          if (hole.stateT < 200) drawDirtSpray(ctx, hole, raw);
          drawMole(ctx, hole.x, cy, hole.r * 0.86 * HITBOX_SCALE, hole.gold, hole.stateT);
          drawBurrowLip(ctx, hole);

          // Countdown ring — you can see exactly how long you have.
          ctx.save();
          ctx.beginPath();
          ctx.arc(hole.x, cy, hole.r * 1.12, -Math.PI / 2, -Math.PI / 2 + remaining * Math.PI * 2);
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

    getDrill() {
      const target = 2;
      return {
        label: "WHACK 2 MOLES EACH",
        tip: "Both hands up — move a hammer onto a mole",
        target,
        progress: this.drill,
        done: this.drill[0] >= target && this.drill[1] >= target,
      };
    },

    getHud() {
      const top = Math.max(this.scores[0], this.scores[1], 1);
      const pod = (side) => {
        const attempts = this.hits[side] + this.misses[side];
        return {
          value: this.scores[side],
          meta: this.penalty[side] > 0
            ? `SWARM x${this.penalty[side]}`
            : attempts > 0 ? `${Math.round((this.hits[side] / attempts) * 100)}% ACCURACY` : "",
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
      const winner = a > b ? 1 : b > a ? 2 : null;
      const top = Math.max(a, b, 1);
      return {
        title: winner ? `PLAYER ${winner} WINS` : "DRAW",
        color: winner === 1 ? C.p1 : winner === 2 ? C.p2 : C.amber,
        winner,
        // Level on points? Whoever swung more accurately.
        tiebreak: [0, 1].map((side) => {
          const attempts = this.hits[side] + this.misses[side];
          return attempts === 0 ? 0 : this.hits[side] / attempts;
        }),
        record: Math.max(a, b),
        rows: [
          { tag: "P1", text: `${this.hits[0]} hit · ${this.misses[0]} escaped`, value: `${a} pts`, ratio: a / top, color: C.p1 },
          { tag: "P2", text: `${this.hits[1]} hit · ${this.misses[1]} escaped`, value: `${b} pts`, ratio: b / top, color: C.p2 },
        ],
      };
    },
  };
}

/* ── Mole artwork ────────────────────────────────────────────────────
   Drawn rather than sprited, so it scales to any hole size and needs no
   asset loading. Reads as a mole at a glance: earthy fur with a lighter
   belly, a pale forward snout, dark nose, small close-set eyes, ears,
   whiskers and digging claws — facing up, out of a mound of soil.
   ─────────────────────────────────────────────────────────────────── */

const FUR = { body: "#7a5230", belly: "#a9784a", dark: "#4e321a", snout: "#e0b48f", nose: "#2a1a10" };
const GOLD_FUR = { body: "#c9962f", belly: "#f0c964", dark: "#8a6416", snout: "#ffe0a8", nose: "#3a2708" };

function drawMole(ctx, x, y, r, gold, stateT) {
  const skin = gold ? GOLD_FUR : FUR;
  const tilt = Math.sin(stateT / 190) * 0.07;   // never a static decal

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  if (gold) { ctx.shadowColor = C.amber; ctx.shadowBlur = 24; }

  // Ears first, so they read as bumps on the silhouette.
  ctx.fillStyle = skin.dark;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * r * 0.66, -r * 0.5, r * 0.2, r * 0.24, side * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body: taller than wide, darker back fading to a lighter belly.
  const grad = ctx.createLinearGradient(0, -r, 0, r);
  grad.addColorStop(0, skin.body);
  grad.addColorStop(1, skin.belly);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.86, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Fur texture.
  ctx.strokeStyle = skin.dark;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(i * r * 0.24, r * 0.16);
    ctx.lineTo(i * r * 0.24 + r * 0.05, r * 0.48);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Snout — the giveaway that this is a mole and not a bear cub.
  ctx.fillStyle = skin.snout;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.3, r * 0.44, r * 0.33, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = skin.nose;
  ctx.beginPath();
  ctx.ellipse(0, r * 0.16, r * 0.15, r * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Whiskers.
  ctx.strokeStyle = skin.dark;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = Math.max(0.8, r * 0.035);
  for (const side of [-1, 1]) {
    for (const lift of [-0.05, 0.05]) {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.16, r * 0.3);
      ctx.lineTo(side * r * 0.74, r * (0.3 + lift * 4));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Small, close-set, squinting eyes.
  ctx.fillStyle = skin.nose;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * r * 0.3, -r * 0.16, r * 0.11, r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * r * 0.3 - r * 0.04, -r * 0.2, r * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }

  // Digging claws hooked over the rim.
  ctx.strokeStyle = skin.snout;
  ctx.lineWidth = Math.max(1.2, r * 0.07);
  for (const side of [-1, 1]) {
    for (let c = -1; c <= 1; c++) {
      ctx.beginPath();
      ctx.moveTo(side * r * 0.6 + c * r * 0.09, r * 0.6);
      ctx.lineTo(side * r * 0.6 + c * r * 0.09, r * 0.8);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// A heaped dirt mound with a dark burrow mouth, not a flat black ellipse.
function drawBurrow(ctx, hole, accent) {
  const { x, y, r } = hole;
  ctx.save();
  const mound = ctx.createLinearGradient(0, y - r * 0.2, 0, y + r * 0.9);
  mound.addColorStop(0, "#6b4a2a");
  mound.addColorStop(1, "#3d2814");
  ctx.fillStyle = mound;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.42, r * 1.34, r * 0.66, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#5a3d22";
  for (let i = 0; i < 7; i++) {
    const a = (Math.PI * 2 * i) / 7 + 0.5;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 1.2, y + r * 0.42 + Math.sin(a) * r * 0.56, r * 0.11, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.36, r * 0.92, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(8, 5, 3, 0.92)";
  ctx.fill();
  ctx.strokeStyle = accent ?? "rgba(120, 88, 56, 0.7)";
  ctx.lineWidth = accent ? 2 : 1.4;
  if (accent) { ctx.shadowColor = accent; ctx.shadowBlur = 14; }
  ctx.stroke();
  ctx.restore();
}

// Front lip drawn over the mole, so it sits *inside* the burrow.
function drawBurrowLip(ctx, hole) {
  const { x, y, r } = hole;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.52, r * 1.18, r * 0.44, 0, Math.PI, Math.PI * 2, true);
  ctx.fillStyle = "#4a3219";
  ctx.fill();
  ctx.restore();
}

// Soil kicked up as the mole breaks the surface.
function drawDirtSpray(ctx, hole, t) {
  const { x, y, r } = hole;
  ctx.save();
  ctx.globalAlpha = 1 - t;
  ctx.fillStyle = "#6b4a2a";
  for (let i = 0; i < 8; i++) {
    const a = Math.PI + (Math.PI * i) / 7;
    const d = r * (0.6 + t * 1.5);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + r * 0.3 + Math.sin(a) * d * 0.6, r * 0.1 * (1 - t) + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
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
        upFor: UP_MS,
      });
    }
  }
  return holes;
}
