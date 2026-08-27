import { createFx, pickRandom, clamp } from "./utils.js";
import { C } from "./theme.js";
import { sfx } from "./audio.js";
import { POSES, getPoints, bodyUnit, createPoseTracker, drawSkeleton, drawStickFigure } from "./poseKit.js";

/* ═══════════════════════════════════════════════════════════════════
   VAULT SYNC — co-op, and the only channel about coordination.

   Hull Breach is parallel work: two people doing the same job faster.
   This is genuinely joint: each player gets their own pose, and the
   tumbler only turns while BOTH are holding at the same moment. One
   player alone can do nothing at all.
   ═══════════════════════════════════════════════════════════════════ */

const VAULT_TIME = 75;
const TUMBLERS = 8;
const HOLD_TIME = 1.3;        // seconds both must hold together
const DECAY = 1.6;            // sync lost per second when out of step

export function createVaultSync() {
  return {
    id: "vaultsync",
    title: "Vault Sync",
    icon: "🔐",
    blurb: "Co-op. Both hold your own pose at the same moment to crack it.",
    players: "2P CO-OP",
    hint: "Both players step back — you each get a different pose",
    tutorial: [
      "You each get your OWN pose — they are usually different.",
      "The tumbler only turns while BOTH of you are holding together.",
      "Crack six tumblers before the timer runs out.",
    ],
    mode: "pose",
    numPoses: 2,
    coop: true,

    init({ view, practice = false }) {
      this.view = view;
      this.practice = practice;
      this.drill = [0];
      this.tracker = createPoseTracker();
      this.players = [createMember(), createMember()];
      this.targets = [pickRandom(POSES), pickRandom(POSES)];
      this.sync = 0;
      this.cracked = 0;
      this.timeLeft = VAULT_TIME;
      this.elapsed = 0;
      this.bestSync = 0;
      this.syncedTime = 0;
      this.flashT = 0;
      this.fx = createFx();
      this.over = false;
      this.success = false;
    },

    onResize(view) { this.view = view; },

    onResults(poses) {
      const assigned = this.tracker.assign(poses);
      this.players[0].landmarks = assigned[0];
      this.players[1].landmarks = assigned[1];
    },

    dealTargets() {
      // Both may be sent the same pose sometimes — it is a nice moment
      // when the crew realises they match.
      this.targets = [pickRandom(POSES, this.targets[0]), pickRandom(POSES, this.targets[1])];
    },

    update(dt) {
      if (this.over) return;
      this.elapsed += dt;
      this.fx.update(dt);
      if (this.flashT > 0) this.flashT -= dt;

      if (!this.practice) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.over = true;
          this.success = false;
          return;
        }
      }

      for (const [index, member] of this.players.entries()) {
        const points = getPoints(member.landmarks, this.view);
        member.tracked = !!points;
        member.matched = !!points && this.targets[index].check(points, bodyUnit(points));
      }

      const together = this.players[0].matched && this.players[1].matched;
      if (together) {
        this.sync += dt;
        this.syncedTime += dt;
        this.bestSync = Math.max(this.bestSync, this.sync);
      } else {
        this.sync = Math.max(0, this.sync - DECAY * dt);
      }

      if (this.sync >= HOLD_TIME) {
        this.sync = 0;
        this.cracked += 1;
        this.flashT = 0.6;
        if (this.practice) this.drill[0] = Math.min(1, this.drill[0] + 1);
        this.fx.burst(this.view.width / 2, this.view.height * 0.5, C.amber, 22, 260);
        this.fx.text(this.view.width / 2, this.view.height * 0.42, "TUMBLER", C.amber);
        sfx.bonus();
        this.dealTargets();
        if (!this.practice && this.cracked >= TUMBLERS) {
          this.over = true;
          this.success = true;
        }
      }
    },

    draw(ctx) {
      const { view } = this;
      const half = view.width / 2;

      for (const [index, member] of this.players.entries()) {
        const originX = index === 0 ? 0 : half;
        const accent = index === 0 ? C.p1 : C.p2;

        if (member.landmarks) {
          drawSkeleton(ctx, member.landmarks, this.view, {
            color: member.matched ? C.p1 : "rgba(233, 236, 255, 0.7)",
            glow: member.matched ? 16 : 8,
          });
        }

        // Each crew member's own target.
        const cx = originX + half / 2;
        const cy = view.height * 0.34;
        drawStickFigure(ctx, cx, cy, 26, this.targets[index].arms,
          member.matched ? C.p1 : "#ffffff", member.matched ? 20 : 10);

        ctx.save();
        ctx.font = '700 13px "Space Grotesk", sans-serif';
        ctx.textAlign = "center";
        ctx.fillStyle = member.matched ? C.p1 : C.text;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fillText(this.targets[index].label, cx, cy + 48);
        ctx.fillStyle = member.matched ? C.p1 : C.muted;
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.fillText(member.tracked ? (member.matched ? "HOLDING" : "NOT YET") : "STEP INTO FRAME", cx, cy + 66);
        ctx.restore();

        if (member.matched) {
          ctx.save();
          ctx.globalAlpha = 0.1;
          ctx.fillStyle = accent;
          ctx.fillRect(originX, 0, half, view.height);
          ctx.restore();
        }
      }

      // The vault dial in the middle: only turns while both are holding.
      const dialY = view.height * 0.66;
      const radius = Math.min(half, view.height) * 0.16;
      const together = this.players[0].matched && this.players[1].matched;
      const progress = clamp(this.sync / HOLD_TIME, 0, 1);

      ctx.save();
      ctx.translate(half, dialY);
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();

      const dialColor = together ? C.p1 : C.amber;
      ctx.strokeStyle = dialColor;
      ctx.shadowColor = dialColor;
      ctx.shadowBlur = together ? 26 : 10;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, 0, radius, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();

      // Tumbler pips around the dial.
      for (let i = 0; i < TUMBLERS; i++) {
        const angle = (Math.PI * 2 * i) / TUMBLERS - Math.PI / 2;
        const done = i < this.cracked;
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * (radius + 20), Math.sin(angle) * (radius + 20), 5, 0, Math.PI * 2);
        ctx.fillStyle = done ? C.amber : "rgba(255,255,255,0.18)";
        ctx.shadowColor = done ? C.amber : "transparent";
        ctx.shadowBlur = done ? 14 : 0;
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.font = '700 20px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.fillText(`${this.cracked}/${TUMBLERS}`, 0, 0);
      ctx.restore();

      ctx.save();
      ctx.font = '700 12px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = together ? C.p1 : C.muted;
      if (together) { ctx.shadowColor = C.p1; ctx.shadowBlur = 12; }
      ctx.fillText(together ? "IN SYNC — HOLD IT" : "BOTH MUST HOLD AT ONCE", half, dialY + radius + 46);
      ctx.restore();

      if (this.flashT > 0) {
        ctx.save();
        ctx.globalAlpha = (this.flashT / 0.6) * 0.3;
        ctx.fillStyle = C.amber;
        ctx.fillRect(0, 0, view.width, view.height);
        ctx.restore();
      }

      this.fx.draw(ctx);
    },

    getDrill() {
      return {
        label: "CRACK 1 TUMBLER TOGETHER",
        tip: "Both hold your own pose at the same time",
        target: 1,
        progress: this.drill,
        coop: true,
        done: this.drill[0] >= 1,
      };
    },

    getHud() {
      return {
        p1: {
          tag: "CRACKED",
          value: `${this.cracked}/${TUMBLERS}`,
          meta: this.players[0].matched && this.players[1].matched ? "IN SYNC" : "OUT OF STEP",
          ratio: this.cracked / TUMBLERS,
          accent: C.amber,
        },
        p2: {
          tag: "SYNC",
          value: `${Math.round(clamp(this.sync / HOLD_TIME, 0, 1) * 100)}%`,
          meta: `${this.players.filter((m) => m.matched).length}/2 HOLDING`,
          ratio: clamp(this.sync / HOLD_TIME, 0, 1),
          accent: this.players[0].matched && this.players[1].matched ? C.p1 : C.ice,
        },
        center: {
          value: Math.ceil(this.timeLeft),
          label: "TO CRACK",
          ratio: this.timeLeft / VAULT_TIME,
          danger: this.timeLeft <= 12,
        },
      };
    },

    isOver() { return this.over; },

    getSummary() {
      const held = VAULT_TIME - this.timeLeft;
      return {
        title: this.success ? "VAULT OPEN" : "LOCKED OUT",
        color: this.success ? C.amber : C.danger,
        winner: null,               // co-op: the crew shares one outcome
        coop: true,
        success: this.success,
        tiebreak: [0, 0],
        record: this.cracked,
        rows: [
          { tag: "CREW", text: `${this.syncedTime.toFixed(1)}s spent in sync`, value: `${this.cracked}/${TUMBLERS}`, ratio: this.cracked / TUMBLERS, color: C.amber },
          { tag: "HOLD", text: this.success ? "cracked it with time to spare" : `longest joint hold ${this.bestSync.toFixed(1)}s`, value: `${held.toFixed(0)}s`, ratio: held / VAULT_TIME, color: C.ice },
        ],
      };
    },
  };
}

function createMember() {
  return { landmarks: null, matched: false, tracked: false };
}
