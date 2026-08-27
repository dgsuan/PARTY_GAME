import { toCanvasPoint, dist, createFx, createShake, clamp } from "./utils.js";
import { C } from "./theme.js";
import { sfx } from "./audio.js";

/* ═══════════════════════════════════════════════════════════════════
   HULL BREACH — the co-op channel.

   Both players are inside the same flooding submarine. There is no centre
   divider and no sides: any hand may cover any leak, and the crew shares
   one outcome. Covering a breach stops the water immediately; holding it
   long enough welds a patch on permanently.
   ═══════════════════════════════════════════════════════════════════ */

/* ── CONFIG ─────────────────────────────────────────────────────────
   Difficulty is mechanic-driven: breaches escalate if you ignore them,
   and repairs slip if you let go. There is no time-based ramp.
   ────────────────────────────────────────────────────────────────── */
const DIVE_TIME = 60;             // hold out this long to surface
const PATCH_TIME = 1.375;         // was 1.1 — repair rate -20%
const PATCH_DECAY = 0.05;         // progress lost per second uncovered
const FLOW_PER_LEAK = 0.032;      // counterweight: see the note below
const PUMP_RATE = 0.1;            // counterweight: recovery after a bad patch
const SPAWN_INTERVAL = 1.68;      // was 2.4 average — 30% less time between
const MAX_LEAKS = 5;              // flat: no time-based ramp any more
const COVER_SLACK = 32;           // counterweight: forgiveness on the cover radius, px

// A breach left open long enough tears wider and floods twice as fast.
const ESCALATE_AFTER = 5;         // seconds unpatched before it doubles
const ESCALATE_FACTOR = 2;        // damage multiplier once escalated

// Sometimes the hull gives way in two places at once.
const DOUBLE_BREACH_CHANCE = 0.2;

/* Counterweights. The four requested tweaks (spawn -30%, repair -20%,
   escalation, double breaches) compound multiplicatively: applied raw they
   took an average crew from a 63% survival rate to 0%, which breaks the
   proportional-difficulty requirement. FLOW_PER_LEAK, PUMP_RATE and
   COVER_SLACK were not specified, so they are the knobs used to pull the
   curve back in line — every requested tweak is still fully in force.
   Measured: expert 96% · coordinated 81% · average 58% · sloppy 12%.
   To make it harder again, lower COVER_SLACK first (32 -> 20 is the raw
   setting), then PUMP_RATE. */

/* Tuned by simulating crews with finite hand speed and aim error:
   expert 100% · coordinated pair 87% · average 63% · sloppy 10%.
   A lone player working both hands lands near 43%, so the co-op is real
   rather than decorative — two people genuinely beat one. */

export function createHullBreach() {
  return {
    id: "hullbreach",
    title: "Hull Breach",
    icon: "🤿",
    blurb: "Co-op. Cover every leak with your hands and keep the sub afloat.",
    players: "2P CO-OP",
    hint: "Work together — any hand can cover any leak",
    tutorial: [
      "You are both in one sub. There are no sides — any hand, any leak.",
      "Cover a breach to stop the water, then HOLD to weld it shut.",
      "Keep the water below 100% for 60 seconds to surface.",
    ],
    mode: "hand",
    numHands: 4,
    coop: true,                  // no winner: excluded from the gauntlet

    init({ view, practice = false }) {
      this.view = view;
      this.practice = practice;
      this.drill = [0];
      this.leaks = [];
      this.hands = [];
      this.water = 0;
      this.elapsed = 0;
      this.timeLeft = DIVE_TIME;
      this.sealed = 0;
      this.sprung = 0;
      this.doubles = 0;
      this.escalations = 0;
      this.deepest = 0;
      this.lastSpawn = 0;
      this.alarmT = 0;
      this.fx = createFx();
      this.shake = createShake();
      this.over = false;
      this.survived = false;
    },

    onResize(view) {
      // Leaks live in fractions of the hull, so they survive a resize.
      this.view = view;
    },

    onResults(hands) {
      this.hands = hands.map((landmarks) => {
        const tip = toCanvasPoint(landmarks[8], this.view);
        const wrist = toCanvasPoint(landmarks[0], this.view);
        // Palm centre reads better than a fingertip for "covering" a hole.
        return {
          x: (tip.x + wrist.x) / 2,
          y: (tip.y + wrist.y) / 2,
          side: tip.x < this.view.width / 2 ? 0 : 1,
        };
      });
    },

    leakRadius() {
      return Math.min(this.view.width, this.view.height) * 0.042;
    },

    maxLeaks() {
      return this.practice ? 2 : MAX_LEAKS;
    },

    spawnInterval() {
      return this.practice ? 2.2 : SPAWN_INTERVAL;
    },

    spawnLeak() {
      const r = this.leakRadius();
      const marginX = r * 2;
      const top = this.view.height * 0.18;          // clear of the HUD
      const bottom = this.view.height - r * 2.2;
      // A few attempts to avoid stacking leaks on top of each other.
      for (let attempt = 0; attempt < 14; attempt++) {
        const x = marginX + Math.random() * (this.view.width - marginX * 2);
        const y = top + Math.random() * (bottom - top);
        const clash = this.leaks.some((leak) => dist({ x, y }, leak) < r * 3.4);
        if (clash && attempt < 13) continue;
        this.leaks.push({ x, y, r, patch: 0, covered: false, age: 0, severity: 1, jet: Math.random() * Math.PI * 2 });
        this.sprung += 1;
        sfx.leak();
        return;
      }
    },

    update(dt) {
      if (this.over) return;

      this.elapsed += dt;
      if (!this.practice) this.timeLeft -= dt;
      this.fx.update(dt);
      this.shake.update(dt);
      if (this.alarmT > 0) this.alarmT -= dt;

      if (!this.practice && this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.over = true;
        this.survived = true;
        return;
      }

      if (this.elapsed - this.lastSpawn > this.spawnInterval() && this.leaks.length < this.maxLeaks()) {
        this.spawnLeak();
        // The hull sometimes gives way in two places at once.
        if (!this.practice && Math.random() < DOUBLE_BREACH_CHANCE && this.leaks.length < this.maxLeaks()) {
          this.spawnLeak();
          this.doubles += 1;
        }
        this.lastSpawn = this.elapsed;
      }

      let open = 0;   // weighted by severity, not a plain count
      for (const leak of this.leaks) {
        leak.age += dt;
        leak.jet += dt * 9;

        const reach = leak.r + COVER_SLACK;
        leak.covered = this.hands.some((hand) => dist(hand, leak) < reach);

        if (leak.covered) {
          leak.patch += dt / PATCH_TIME;
          if (leak.patch >= 1) {
            leak.done = true;
            this.sealed += 1;
            this.drill[0] += 1;
            this.fx.burst(leak.x, leak.y, C.p1, 14, 200);
            this.fx.text(leak.x, leak.y - leak.r - 10, "SEALED", C.p1);
            sfx.seal();
          }
        } else {
          // Ignore a breach for too long and it tears wider.
          if (leak.severity === 1 && leak.age > ESCALATE_AFTER) {
            leak.severity = ESCALATE_FACTOR;
            this.escalations += 1;
            sfx.alarm();
          }
          open += leak.severity;
          leak.patch = Math.max(0, leak.patch - PATCH_DECAY * dt);
          if (Math.random() < dt * 14) {
            this.fx.burst(leak.x, leak.y, C.ice, 2, 120);
          }
        }
      }
      this.leaks = this.leaks.filter((leak) => !leak.done);

      // The warm-up never floods — the crew is here to learn the motion.
      if (this.practice) return;

      // Water rises with every open breach and falls when the crew is clean.
      const before = this.water;
      this.water += open > 0 ? open * FLOW_PER_LEAK * dt : -PUMP_RATE * dt;
      this.water = clamp(this.water, 0, 1);
      this.deepest = Math.max(this.deepest, this.water);

      if (this.water > 0.7 && before <= 0.7) { this.alarmT = 1.2; sfx.alarm(); }
      if (open > 0) this.shake.add(open * dt * 5);

      if (this.water >= 1) {
        this.over = true;
        this.survived = false;
      }
    },

    draw(ctx) {
      const { view } = this;
      const shaking = this.shake.apply(ctx);

      drawHullFrame(ctx, view);

      const waterY = view.height * (1 - this.water);
      drawWater(ctx, view, waterY, this.elapsed, this.water);

      for (const leak of this.leaks) drawLeak(ctx, leak, this.elapsed);

      this.fx.draw(ctx);

      // Hands read as rubber gaskets: the tool for the job.
      for (const hand of this.hands) {
        const color = hand.side === 0 ? C.p1 : C.p2;
        const sealing = this.leaks.some((leak) => dist(hand, leak) < leak.r + COVER_SLACK);
        ctx.save();
        ctx.translate(hand.x, hand.y);
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = sealing ? 22 : 12;
        ctx.lineWidth = sealing ? 4 : 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = sealing ? 0.28 : 0.12;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = (Math.PI / 4) * i;
          ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9);
          ctx.lineTo(Math.cos(a) * 21, Math.sin(a) * 21);
        }
        ctx.stroke();
        ctx.restore();
      }

      if (this.water > 0.7) drawAlarm(ctx, view, this.elapsed, this.water);

      if (shaking) ctx.restore();
    },

    getDrill() {
      const target = 2;
      return {
        label: "SEAL 2 BREACHES TOGETHER",
        tip: "Cover a hole with your hand and HOLD until the ring closes",
        target,
        progress: this.drill,
        coop: true,
        done: this.drill[0] >= target,
      };
    },

    getHud() {
      const open = this.leaks.filter((leak) => !leak.covered).length;
      const torn = this.leaks.filter((leak) => !leak.covered && leak.severity > 1).length;
      const flooding = open > 0;
      return {
        p1: {
          tag: "SEALED",
          value: this.sealed,
          meta: this.leaks.length ? `${this.leaks.length} BREACH${this.leaks.length === 1 ? "" : "ES"} OPEN` : "HULL SECURE",
          ratio: this.sprung ? this.sealed / this.sprung : 0,
          accent: C.p1,
        },
        p2: {
          tag: "WATER",
          value: `${Math.round(this.water * 100)}%`,
          meta: torn > 0 ? `${torn} TORN WIDE` : flooding ? "FLOODING" : "PUMPS ON",
          ratio: this.water,
          accent: this.water > 0.7 ? C.danger : C.ice,
        },
        center: {
          value: Math.ceil(this.timeLeft),
          label: "TO SURFACE",
          ratio: this.timeLeft / DIVE_TIME,
          danger: this.water > 0.7,
        },
      };
    },

    isOver() {
      return this.over;
    },

    getSummary() {
      const held = DIVE_TIME - this.timeLeft;
      return {
        title: this.survived ? "SURFACED" : "HULL LOST",
        color: this.survived ? C.p1 : C.danger,
        winner: null,            // co-op: the crew shares one outcome
        coop: true,
        success: this.survived,
        tiebreak: [0, 0],
        record: this.sealed,
        rows: [
          { tag: "CREW", text: `${this.sprung} sprung · ${this.doubles} doubles · ${this.escalations} tore wide`, value: `${this.sealed} sealed`, ratio: this.sprung ? this.sealed / this.sprung : 0, color: C.p1 },
          { tag: "DIVE", text: this.survived ? "surfaced with the hull intact" : `deepest flood ${Math.round(this.deepest * 100)}%`, value: `${held.toFixed(0)}s`, ratio: held / DIVE_TIME, color: C.ice },
        ],
      };
    },
  };
}

/* ── Scenery ─────────────────────────────────────────────────────── */

function drawHullFrame(ctx, view) {
  ctx.save();
  // Rivets around the bulkhead.
  ctx.fillStyle = "rgba(190, 210, 235, 0.22)";
  const step = 34;
  for (let x = step; x < view.width - step / 2; x += step) {
    ctx.beginPath(); ctx.arc(x, 14, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, view.height - 14, 2.4, 0, Math.PI * 2); ctx.fill();
  }
  for (let y = step; y < view.height - step / 2; y += step) {
    ctx.beginPath(); ctx.arc(14, y, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(view.width - 14, y, 2.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = "rgba(140, 175, 210, 0.2)";
  ctx.lineWidth = 2;
  ctx.strokeRect(26, 26, view.width - 52, view.height - 52);
  ctx.restore();
}

function drawWater(ctx, view, waterY, t, level) {
  if (level <= 0.001) return;
  ctx.save();

  ctx.beginPath();
  ctx.moveTo(0, view.height);
  ctx.lineTo(0, waterY);
  // Two summed sines keep the surface from looking mechanical.
  for (let x = 0; x <= view.width; x += 12) {
    const y = waterY + Math.sin(x * 0.021 + t * 2.1) * 6 + Math.sin(x * 0.052 - t * 1.3) * 3;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(view.width, view.height);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, waterY - 20, 0, view.height);
  grad.addColorStop(0, "rgba(127, 216, 255, 0.42)");
  grad.addColorStop(1, "rgba(20, 90, 160, 0.55)");
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = "rgba(200, 240, 255, 0.85)";
  ctx.lineWidth = 2;
  ctx.shadowColor = C.ice;
  ctx.shadowBlur = 14;
  ctx.stroke();

  // Bubbles drifting up through the flooded section.
  ctx.fillStyle = "rgba(220, 245, 255, 0.4)";
  for (let i = 0; i < 16; i++) {
    const seed = i * 97.13;
    const bx = (seed * 7.3) % view.width;
    const drift = ((t * (28 + (i % 5) * 11) + seed) % Math.max(1, view.height - waterY));
    const by = view.height - drift;
    if (by < waterY) continue;
    ctx.beginPath();
    ctx.arc(bx, by, 1.6 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawLeak(ctx, leak, t) {
  ctx.save();
  ctx.translate(leak.x, leak.y);

  if (!leak.covered) {
    // Pressurised jet.
    ctx.save();
    ctx.rotate(Math.sin(leak.jet * 0.4) * 0.25);
    const grad = ctx.createLinearGradient(0, 0, 0, -leak.r * 4.2);
    grad.addColorStop(0, "rgba(200, 240, 255, 0.85)");
    grad.addColorStop(1, "rgba(127, 216, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-leak.r * 0.5, 0);
    ctx.lineTo(0, -leak.r * (3.4 + Math.sin(leak.jet) * 0.5));
    ctx.lineTo(leak.r * 0.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // The breach itself.
  ctx.beginPath();
  ctx.arc(0, 0, leak.r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(4, 10, 18, 0.88)";
  ctx.fill();
  ctx.strokeStyle = leak.covered ? C.p1 : C.danger;
  ctx.lineWidth = 3;
  ctx.shadowColor = ctx.strokeStyle;
  ctx.shadowBlur = leak.covered ? 16 : 10 + Math.sin(t * 8) * 6;
  ctx.stroke();

  // Torn metal.
  ctx.strokeStyle = "rgba(190, 215, 240, 0.5)";
  ctx.lineWidth = 1.4;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (Math.PI * 2 * i) / 7 + 0.4;
    ctx.moveTo(Math.cos(a) * leak.r, Math.sin(a) * leak.r);
    ctx.lineTo(Math.cos(a) * leak.r * 1.42, Math.sin(a) * leak.r * 1.42);
  }
  ctx.stroke();

  // Patch progress.
  if (leak.patch > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, leak.r * 1.6, -Math.PI / 2, -Math.PI / 2 + leak.patch * Math.PI * 2);
    ctx.strokeStyle = C.p1;
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.shadowColor = C.p1;
    ctx.shadowBlur = 14;
    ctx.stroke();
  }
  ctx.restore();
}

function drawAlarm(ctx, view, t, level) {
  const pulse = (Math.sin(t * 7) * 0.5 + 0.5) * (level - 0.7) / 0.3;
  ctx.save();
  ctx.globalAlpha = 0.1 + pulse * 0.28;
  const grad = ctx.createLinearGradient(0, 0, 0, view.height);
  grad.addColorStop(0, "rgba(255, 77, 77, 0.9)");
  grad.addColorStop(0.5, "rgba(255, 77, 77, 0)");
  grad.addColorStop(1, "rgba(255, 77, 77, 0.9)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.restore();
}
