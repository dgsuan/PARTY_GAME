import { HandLandmarker, PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { createSignalPop } from "./signalPop.js";
import { createWhackAMole } from "./whackAMole.js";
import { createCopyPose } from "./copyPose.js";
import { createIceBreaker } from "./iceBreaker.js";
import { createHullBreach } from "./hullBreach.js";
import { createFreezeFrame } from "./freezeFrame.js";
import { createBeamDodge } from "./beamDodge.js";
import { createTugOfWar } from "./tugOfWar.js";
import { createVaultSync } from "./vaultSync.js";
import { createEcho } from "./echoGame.js";
import { mountPreview, startPreviews, stopPreviews, measurePreviews } from "./previews.js";
import { sfx, unlock, isMuted, setMuted } from "./audio.js";
import { pickRandom, toCanvasPoint } from "./utils.js";
import { C } from "./theme.js";

/* ═══════════════════════════════════════════════════════════════════
   Game contract — every factory returns an object with:

     id, title, icon, blurb, players, mode ("hand" | "pose"), numHands?
     init({ canvas, ctx, view })   view = logical CSS-pixel size
     onResize(view)                geometry must be rebuilt, not scaled
     onResults(landmarks)
     update(dt)  /  draw(ctx)  /  isOver()
     getHud()      -> { p1, p2, center } for the DOM heads-up display
     getSummary()  -> { title, color, rows[], record }

   Games never draw their own score text: the HUD is DOM, so it stays
   crisp and consistent across all four channels.
   ═══════════════════════════════════════════════════════════════════ */

const GAMES = [
  createSignalPop, createWhackAMole, createCopyPose, createIceBreaker, createHullBreach,
  createFreezeFrame, createBeamDodge, createTugOfWar, createVaultSync, createEcho,
];

// Metadata is stable, so build it once instead of re-instantiating games.
const META = GAMES.map((factory) => factory());

// The gauntlet is a last-player-standing format, so it can only draw on
// versus channels — a co-op round has no loser to take a life from.
const VERSUS_GAMES = GAMES.filter((_, index) => !META[index].coop);

const $ = (id) => document.getElementById(id);

const video = $("webcam");
const canvas = $("game");
const ctx = canvas.getContext("2d", { alpha: true });
const menuScreen = $("menuScreen");
const menuGrid = $("menuGrid");
const errorScreen = $("errorScreen");
const loadingScreen = $("loadingScreen");
const gameOverScreen = $("gameOverScreen");
const countScreen = $("countScreen");
const briefScreen = $("briefScreen");
const pauseScreen = $("pauseScreen");
const errorMsg = $("errorMsg");
const quitBtn = $("quitBtn");
const hud = $("hud");
const toast = $("toast");

const view = { width: 1, height: 1, videoWidth: 0, videoHeight: 0 };

let state = "menu";           // menu | loading | warmup | countdown | playing | paused | over | error
let cards = [];
let cursor = 0;
let selectedFactory = null;
let currentGame = null;
let cameraStream = null;
let landmarkers = new Map();  // "hand:4" -> instance, so numHands is honoured
let rafId = null;
let lastFrameTime = 0;
let lastVideoTime = -1;
let sequenceToken = 0;        // cancels an in-flight countdown/boot
let subjects = 0;
let lastResults = [];
let noSubjectSince = 0;
let toastTimer = null;

/* ── Play modes ──────────────────────────────────────────────────────
   "single"   one chosen channel, rematch replays the same one
   "shuffle"  a random channel; rematch deals another
   "gauntlet" random channels back to back, three lives each — a match
              loss costs a life, and the series ends when someone hits 0
   ─────────────────────────────────────────────────────────────────── */
const SERIES_LIVES = 3;
let playMode = "single";
const series = { lives: [SERIES_LIVES, SERIES_LIVES], round: 0, history: [], lastLost: null, lastDecision: null, over: false };

function resetSeries() {
  series.lives = [SERIES_LIVES, SERIES_LIVES];
  series.round = 0;
  series.history.length = 0;
  series.lastLost = null;
  series.lastDecision = null;
  series.over = false;
}

/* ── Small DOM helpers ───────────────────────────────────────────── */
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");
const panels = () => [menuScreen, errorScreen, loadingScreen, gameOverScreen, countScreen, pauseScreen, briefScreen];

function setState(next) {
  state = next;
  for (const panel of panels()) hide(panel);
  hud.classList.add("hidden");
  quitBtn.classList.add("hidden");

  cancelAutoNext();
  if (next === "menu") { show(menuScreen); startPreviews("menu"); }
  else if (next === "warmup") show(briefScreen);
  else stopPreviews();

  if (next === "loading") show(loadingScreen);
  if (next === "error") show(errorScreen);
  if (next === "over") show(gameOverScreen);
  if (next === "paused") { show(pauseScreen); hud.classList.remove("hidden"); }
  if (next === "warmup") hud.classList.remove("hidden");
  if (next === "countdown") { show(countScreen); quitBtn.classList.remove("hidden"); }
  if (next === "playing") { hud.classList.remove("hidden"); quitBtn.classList.remove("hidden"); }

  $("modeValue").textContent = {
    menu: "IDLE", loading: "BOOT", warmup: "DRILL", countdown: "READY",
    playing: "LIVE", paused: "HOLD", over: "RESULT", error: "FAULT",
  }[next] || "IDLE";

  $("headChannel").textContent = currentGame && next !== "menu"
    ? `CH.${String(GAMES.findIndex((f) => f === selectedFactory) + 1).padStart(2, "0")}`
    : "CH.——";
  $("headTitle").textContent = currentGame && next !== "menu" ? currentGame.title : "CHANNEL SELECT";
  renderSeriesBar();
}

// Renders life pips into a container. `losing` animates the pip that was
// just spent, so a lost life is felt rather than merely displayed.
function renderLives(host, side, lives, losing = false) {
  host.replaceChildren(...Array.from({ length: SERIES_LIVES }, (_, index) => {
    const pip = document.createElement("i");
    pip.className = "life";
    pip.dataset.side = String(side);
    if (index >= lives) pip.classList.add("spent");
    if (losing && index === lives) pip.classList.add("losing");
    return pip;
  }));
}

function renderSeriesBar(animateLoss = false) {
  const bar = $("seriesBar");
  if (playMode !== "gauntlet") { hide(bar); return; }
  show(bar);
  renderLives($("lives1"), 1, series.lives[0], animateLoss && series.lastLost === 0);
  renderLives($("lives2"), 2, series.lives[1], animateLoss && series.lastLost === 1);
  $("seriesRound").textContent = series.over
    ? "SERIES OVER"
    : `ROUND ${Math.max(1, series.round)}${currentGame ? ` · ${currentGame.title.toUpperCase()}` : ""}`;
}

function flash(message, ms = 2200) {
  toast.textContent = message;
  show(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(toast), ms);
}

/* ── Canvas sizing (HiDPI-correct) ───────────────────────────────── */
function syncVideoSize() {
  view.videoWidth = video.videoWidth || 0;
  view.videoHeight = video.videoHeight || 0;
}

function layout() {
  syncVideoSize();
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.width = Math.max(1, Math.round(rect.width));
  view.height = Math.max(1, Math.round(rect.height));
  canvas.width = Math.round(view.width * dpr);
  canvas.height = Math.round(view.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* ── Menu ────────────────────────────────────────────────────────── */
function buildMenu() {
  const accents = [
  "var(--p1)", "var(--p2)", "var(--violet)", "var(--ice)", "var(--amber)",
  "var(--danger)", "var(--amber)", "var(--p2)", "var(--violet)", "var(--ice)",
];
  GAMES.forEach((factory, index) => {
    const meta = META[index];
    const card = document.createElement("button");
    card.type = "button";
    card.className = meta.coop ? "channel channel-coop" : "channel";
    card.style.setProperty("--accent", accents[index % accents.length]);
    card.setAttribute("aria-current", index === 0 ? "true" : "false");
    card.innerHTML = `
      <span class="ch-num">${index + 1}</span>
      <span class="ch-top">
        <span class="ch-code">CH.${String(index + 1).padStart(2, "0")}</span>
        <span class="ch-players">${meta.players}</span>
      </span>
      <canvas class="ch-preview" aria-hidden="true"></canvas>
      <span class="ch-title">${meta.icon} ${meta.title}</span>
      <span class="ch-blurb">${meta.blurb}</span>
      <span class="ch-foot">
        <span class="ch-best" data-best></span>
        <span class="ch-go">TUNE IN ▸</span>
      </span>`;

    card.addEventListener("click", () => { moveCursor(index); startSingle(factory); });
    card.addEventListener("mouseenter", () => { if (cursor !== index) { moveCursor(index); sfx.hover(); } });
    card.addEventListener("focus", () => moveCursor(index));

    menuGrid.appendChild(card);
    mountPreview(card.querySelector(".ch-preview"), meta.id);
    cards.push({ el: card, factory, meta });
  });
  refreshRecords();
}

function moveCursor(index) {
  cursor = (index + cards.length) % cards.length;
  cards.forEach((card, i) => card.el.setAttribute("aria-current", i === cursor ? "true" : "false"));
}

const recordKey = (id) => `sa.best.${id}`;

// Storage access throws outright in some privacy modes; records are a nicety,
// never a reason for the app to fail to start.
function getRecord(id) {
  try { return Number(localStorage.getItem(recordKey(id)) || 0); }
  catch { return 0; }
}
function setRecord(id, value) {
  try { localStorage.setItem(recordKey(id), String(value)); } catch { /* ignore */ }
}

function refreshRecords() {
  for (const card of cards) {
    const best = getRecord(card.meta.id);
    card.el.querySelector("[data-best]").textContent = best > 0 ? `BEST ${best}` : "NO RECORD";
  }
}

/* ── Camera + models ─────────────────────────────────────────────── */
function cameraLive() {
  return !!cameraStream && cameraStream.getVideoTracks().some((track) => track.readyState === "live");
}

async function startCamera() {
  if (cameraLive()) return;
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = cameraStream;
  if (video.readyState < 2) {
    await new Promise((resolve) => { video.onloadedmetadata = resolve; });
  }
  await video.play();
  syncVideoSize();
  lastVideoTime = -1;
  setChip($("chipCam"), "on", "CAMERA");
  document.querySelector('[data-led="cam"]').classList.add("on");
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.srcObject = null;
  lastVideoTime = -1;
  setChip($("chipCam"), "off", "CAMERA");
  document.querySelector('[data-led="cam"]').classList.remove("on");
}

let visionPromise = null;
function getVision() {
  visionPromise ??= FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  return visionPromise;
}

// Cached per mode *and* per hand count — Whack-a-Mole needs four hands,
// the others only two, and a landmarker's numHands is fixed at creation.
async function getLandmarker(game) {
  const count = game.mode === "pose" ? (game.numPoses || 2) : (game.numHands || 2);
  const key = `${game.mode}:${count}`;
  if (landmarkers.has(key)) return landmarkers.get(key);
  const vision = await getVision();

  const build = (delegate) => (game.mode === "pose"
    ? PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate,
        },
        runningMode: "VIDEO",
        numPoses: count,
      })
    : HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate,
        },
        runningMode: "VIDEO",
        numHands: count,
      }));

  // The GPU delegate is the fast path but is not available everywhere —
  // WebKit in particular can refuse it. Falling back to CPU keeps the game
  // playable at a lower frame rate instead of failing outright.
  let instance;
  try {
    instance = await build("GPU");
  } catch (error) {
    console.warn("GPU delegate unavailable, falling back to CPU", error);
    instance = await build("CPU");
    flash("GPU UNAVAILABLE — RUNNING ON CPU", 3200);
  }

  landmarkers.set(key, instance);
  return instance;
}

function setStep(el, value) { el.dataset.state = value; }
function setChip(el, value, text) {
  el.dataset.state = value;
  if (text) {
    const label = el.querySelector("span");
    if (label) label.textContent = text;
    else el.lastChild.textContent = text;
  }
}

/* ── Play-mode entry points ──────────────────────────────────────── */

function startSingle(factory) {
  playMode = "single";
  resetSeries();
  launch(factory);
}

// A random channel, never the one just played.
function startShuffle() {
  playMode = "shuffle";
  resetSeries();
  launch(pickRandom(GAMES, selectedFactory));
}

function startGauntlet() {
  playMode = "gauntlet";
  resetSeries();
  nextRound();
}

function nextRound() {
  series.round += 1;
  series.lastLost = null;
  launch(pickRandom(VERSUS_GAMES, selectedFactory));
}

// What the primary results button should do next, given the mode.
function primaryAction() {
  if (playMode === "gauntlet") return series.over ? startGauntlet : nextRound;
  if (playMode === "shuffle") return startShuffle;
  return () => launch(selectedFactory);
}


/* ── Warm-up ─────────────────────────────────────────────────────────
   Every match opens with a short, real playthrough of the channel rather
   than a wall of text. The game runs with its teeth pulled — no bombs, no
   clock, no flooding — and each player has a small objective to complete.
   Finishing the drill proves the tracking works far better than a readout
   does, because you only complete it by actually being seen.
   ─────────────────────────────────────────────────────────────────── */
const WARMUP_TIMEOUT = 40;   // start anyway rather than trapping anyone
const TIP_EVERY = 3.6;       // seconds each tutorial line stays up
let warmElapsed = 0;
let tipIndex = 0;
let warmResolve = null;
let present = [false, false];

function warmup(token) {
  return new Promise((resolve) => {
    warmResolve = () => { warmResolve = null; resolve(); };
    warmElapsed = 0;
    present = [false, false];

    const drill = currentGame.getDrill?.();
    const coop = !!currentGame.coop;

    $("drillLabel").textContent = drill?.label || "TRY IT OUT";
    briefScreen.classList.toggle("coop", coop);
    $("readyName1").textContent = coop ? "CREW" : "P1";
    $("readyName2").textContent = "P2";
    tipIndex = 0;

    // Real game, practice settings.
    currentGame.init({ canvas, ctx, view, practice: true });

    setState("warmup");
    startLoop();

    if (token !== sequenceToken) warmResolve?.();
  });
}

// Which halves of the frame currently hold a tracked player.
function detectPresence() {
  const found = [false, false];
  if (!currentGame) return found;

  if (currentGame.mode === "pose") {
    for (const pose of lastResults) {
      if (!pose[11] || !pose[12] || !pose[23] || !pose[24]) continue;
      const shoulders = (pose[11].x + pose[12].x) / 2;
      const hips = (pose[23].x + pose[24].x) / 2;
      const centre = 1 - (shoulders + hips) / 2;   // mirrored screen space
      found[centre < 0.5 ? 0 : 1] = true;
    }
  } else {
    for (const hand of lastResults) {
      if (!hand[8]) continue;
      const point = toCanvasPoint(hand[8], view);
      found[point.x < view.width / 2 ? 0 : 1] = true;
    }
  }
  return found;
}

function updateWarmup(dt) {
  warmElapsed += dt;
  present = detectPresence();

  const drill = currentGame.getDrill?.() ?? { target: 1, progress: [1, 1], done: true };
  const coop = !!drill.coop;
  const sides = coop ? [0] : [0, 1];

  for (const side of sides) {
    const value = drill.progress[side] ?? 0;
    const complete = value >= drill.target;
    const slot = $(`readySlot${side + 1}`);
    // Three states, and they say different things: waiting (not seen),
    // tracked (seen, still working), done (drill complete).
    const next = complete ? "done" : present[side] || coop ? "tracked" : "waiting";
    if (slot.dataset.state !== next) slot.dataset.state = next;

    const text = `${Math.min(value, drill.target)}/${drill.target}`;
    const countEl = $(`readyState${side + 1}`);
    if (countEl.textContent !== text) countEl.textContent = text;
  }

  const timedOut = warmElapsed > WARMUP_TIMEOUT;
  const missing = !coop && (!present[0] || !present[1]);

  // Status wins the tip slot when it matters; otherwise the tutorial lines
  // rotate through it, one at a time, so they cost no screen space.
  let tip;
  if (drill.done) tip = "Nice — starting the real match…";
  else if (timedOut) tip = "Starting anyway — you can join once the round begins";
  else if (missing) {
    tip = currentGame.mode === "pose"
      ? "Step back until both players fit, one on each side"
      : "Both players: raise a hand into your half of the screen";
  } else {
    const lines = currentGame.tutorial || [];
    const rotated = lines.length ? lines[Math.floor(warmElapsed / TIP_EVERY) % lines.length] : "";
    tip = rotated || drill.tip || "Try it out";
  }
  const promptEl = $("briefPrompt");
  if (promptEl.textContent !== tip) promptEl.textContent = tip;

  if (drill.done || timedOut) finishWarmup();
}

function finishWarmup() {
  if (!warmResolve) return;
  const done = warmResolve;
  warmResolve = null;
  done();
}

// A light frame around each half so players know which side is theirs.
function drawWarmupGuides(ctx) {
  if (currentGame.coop) return;
  const half = view.width / 2;
  const inset = 12;

  for (const side of [0, 1]) {
    const x = side === 0 ? inset : half + inset / 2;
    const w = half - inset * 1.5;
    const color = side === 0 ? C.p1 : C.p2;
    const ok = present[side];
    ctx.save();
    ctx.globalAlpha = ok ? 0.35 : 0.5;
    ctx.strokeStyle = ok ? color : "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.setLineDash(ok ? [] : [10, 8]);
    ctx.strokeRect(x, inset, w, view.height - inset * 2);
    ctx.restore();

    if (!ok) {
      ctx.save();
      ctx.font = '700 13px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillStyle = C.amber;
      ctx.globalAlpha = 0.6 + Math.sin(performance.now() / 240) * 0.4;
      ctx.shadowColor = C.amber;
      ctx.shadowBlur = 10;
      ctx.fillText(`PLAYER ${side + 1} — STEP INTO FRAME`, x + w / 2, view.height / 2);
      ctx.restore();
    }
  }
}

/* ── Launch sequence ─────────────────────────────────────────────── */
async function launch(factory) {
  unlock();
  sfx.select();
  selectedFactory = factory || selectedFactory;
  if (!selectedFactory) return;

  const token = ++sequenceToken;
  finishWarmup();          // release a warm-up left over from a prior launch
  stopLoop();
  resetHudCache();
  currentGame = selectedFactory();
  setState("loading");
  setStep($("stepCam"), "active");
  setStep($("stepModel"), "pending");
  setStep($("stepCal"), "pending");

  try {
    await startCamera();
    if (token !== sequenceToken) return;
    setStep($("stepCam"), "done");
    setStep($("stepModel"), "active");

    await getLandmarker(currentGame);
    if (token !== sequenceToken) return;
    setStep($("stepModel"), "done");
    setStep($("stepCal"), "active");
  } catch (error) {
    console.error(error);
    if (token !== sequenceToken) return;
    stopCamera();
    errorMsg.textContent = error?.name === "NotAllowedError"
      ? "Camera permission was denied. Allow camera access in your browser, then try again."
      : error?.name === "NotFoundError"
        ? "No camera was found on this device."
        : "Could not start the camera or load the tracking model. Check your connection and try again.";
    setState("error");
    return;
  }

  layout();
  currentGame.init({ canvas, ctx, view });
  setStep($("stepCal"), "done");
  await warmup(token);
  if (token !== sequenceToken) return;

  // Throw away the practice run and start the real match from zero.
  currentGame.init({ canvas, ctx, view });
  resetHudCache();
  await countdown(token);
}

function countdown(token) {
  return new Promise((resolve) => {
    setState("countdown");
    $("countHint").textContent = playMode === "gauntlet"
      ? `ROUND ${series.round} · ${currentGame.title.toUpperCase()} — ${currentGame.hint || "step into frame"}`
      : currentGame.hint || "Step into frame";
    let n = 3;
    const numEl = $("countNum");
    numEl.textContent = String(n);
    sfx.count();
    startLoop();

    const tick = () => {
      if (token !== sequenceToken) return resolve();
      n -= 1;
      if (n === 0) {
        numEl.textContent = "GO";
        sfx.go();
        setTimeout(() => {
          if (token !== sequenceToken) return resolve();
          setState("playing");
          lastFrameTime = performance.now();
          resolve();
        }, 620);
        return;
      }
      numEl.textContent = String(n);
      sfx.count();
      setTimeout(tick, 800);
    };
    setTimeout(tick, 800);
  });
}

/* ── Frame loop ──────────────────────────────────────────────────── */
function startLoop() {
  if (rafId !== null) return;
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
}

function detect(timestampMs) {
  if (!currentGame || video.readyState < 2) return;
  // Feeding MediaPipe the same frame twice is wasted work (and some builds
  // reject a non-advancing timestamp), so only run on a fresh frame.
  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const landmarker = landmarkers.get(`${currentGame.mode}:${currentGame.mode === "pose" ? (currentGame.numPoses || 2) : (currentGame.numHands || 2)}`);
  if (!landmarker) return;

  const result = landmarker.detectForVideo(video, timestampMs);
  const found = result.landmarks || [];
  subjects = found.length;
  lastResults = found;
  currentGame.onResults(found);
}

function tick(now) {
  rafId = requestAnimationFrame(tick);
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  try {
    detect(now);
  } catch (error) {
    console.error("tracking error", error);
  }

  updateTracking(now);

  ctx.clearRect(0, 0, view.width, view.height);

  if (state === "playing") {
    currentGame.update(dt);
    currentGame.draw(ctx);
    updateHud();
    if (currentGame.isOver()) finish();
  } else if (state === "countdown") {
    currentGame.draw(ctx);   // players can see the board while they get set
  } else if (state === "warmup") {
    currentGame.update(dt);
    currentGame.draw(ctx);
    drawWarmupGuides(ctx);
    updateHud();
    updateWarmup(dt);
  }

  measureFps(now);
}

function updateTracking(now) {
  $("subjValue").textContent = String(subjects);
  const trackLed = document.querySelector('[data-led="track"]');
  if (subjects > 0) {
    noSubjectSince = 0;
    trackLed.classList.add("on");
    setChip($("chipTrack"), "on", subjects === 1 ? "1 SUBJECT" : `${subjects} SUBJECTS`);
  } else {
    trackLed.classList.remove("on");
    setChip($("chipTrack"), "warn", "NO SUBJECT");
    if (state === "playing") {
      if (noSubjectSince === 0) noSubjectSince = now;
      else if (now - noSubjectSince > 1500 && toast.classList.contains("hidden")) {
        flash(currentGame.mode === "pose" ? "STEP BACK — FULL BODY IN FRAME" : "RAISE YOUR HANDS INTO FRAME");
        noSubjectSince = now;
      }
    }
  }
}

/* ── HUD (DOM, updated only when values change) ──────────────────── */
const hudCache = { v1: null, v2: null, c: null, m1: null, m2: null, cl: null, t1: null, t2: null };
const DASH = 119.4;

function updateHud() {
  const data = currentGame.getHud?.();
  if (!data) return;
  writePod(1, data.p1);
  writePod(2, data.p2);

  if (data.center) {
    const value = String(data.center.value);
    if (value !== hudCache.c) {
      hudCache.c = value;
      $("hudCenter").textContent = value;
    }
    if (data.center.label !== hudCache.cl) {
      hudCache.cl = data.center.label;
      $("hudCenterLabel").textContent = data.center.label;
    }
    const fill = $("dialFill");
    fill.style.strokeDashoffset = String(DASH * (1 - clamp01(data.center.ratio)));
    fill.classList.toggle("low", !!data.center.danger);
  }
}

function writePod(index, pod) {
  if (!pod) return;
  const valueEl = $(`hudValue${index}`);
  const value = String(pod.value);
  const key = index === 1 ? "v1" : "v2";
  if (value !== hudCache[key]) {
    hudCache[key] = value;
    valueEl.textContent = value;
    valueEl.classList.add("bump");
    setTimeout(() => valueEl.classList.remove("bump"), 130);
  }
  // Co-op relabels the pods (SEALED / WATER) and recolours them.
  const tagKey = index === 1 ? "t1" : "t2";
  const tag = pod.tag || `P${index}`;
  if (tag !== hudCache[tagKey]) {
    hudCache[tagKey] = tag;
    $(`hudTag${index}`).textContent = tag;
  }
  if (pod.accent) $(`hudPod${index}`).style.setProperty("--accent", pod.accent);

  const metaKey = index === 1 ? "m1" : "m2";
  if (pod.meta !== hudCache[metaKey]) {
    hudCache[metaKey] = pod.meta;
    $(`hudMeta${index}`).textContent = pod.meta || "";
  }
  $(`hudBar${index}`).style.width = `${clamp01(pod.ratio ?? 0) * 100}%`;
}

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function resetHudCache() {
  hudCache.v1 = hudCache.v2 = hudCache.c = hudCache.m1 = hudCache.m2 = hudCache.cl = null;
  hudCache.t1 = hudCache.t2 = null;
  // Versus games rely on the stylesheet defaults for pod colour.
  $("hudPod1").style.removeProperty("--accent");
  $("hudPod2").style.removeProperty("--accent");
}

/* ── FPS meter ───────────────────────────────────────────────────── */
const fpsBars = [];
let fpsSamples = [];
let fpsLastReport = 0;

function buildFpsBars() {
  const host = $("fpsBars");
  for (let i = 0; i < 16; i++) {
    const bar = document.createElement("i");
    bar.style.height = "2px";
    host.appendChild(bar);
    fpsBars.push(bar);
  }
}

function measureFps(now) {
  fpsSamples.push(now);
  while (fpsSamples.length > 0 && now - fpsSamples[0] > 1000) fpsSamples.shift();
  if (now - fpsLastReport < 250) return;
  fpsLastReport = now;
  const fps = fpsSamples.length;
  $("fpsValue").textContent = String(fps);
  const bar = fpsBars.shift();
  if (bar) {
    bar.style.height = `${Math.max(2, Math.min(12, (fps / 60) * 12))}px`;
    bar.style.opacity = fps < 20 ? "0.4" : "0.9";
    bar.style.background = fps < 20 ? "var(--danger)" : fps < 40 ? "var(--amber)" : "var(--p1)";
    $("fpsBars").appendChild(bar);
    fpsBars.push(bar);
  }
}

/* ── End of match ────────────────────────────────────────────────── */
/* ── Deciding a gauntlet round ───────────────────────────────────────
   A gauntlet round must always produce a loser. If it did not, a run of
   drawn rounds would deduct no lives and the series could never end.
   Resolution order:
     1. the game's own winner
     2. the game's tiebreak metric (best streak, accuracy, damage, …)
     3. the player who is behind on lives — which also guarantees the
        series terminates, since every round now removes exactly one life
     4. a coin toss, if even that is level
   ─────────────────────────────────────────────────────────────────── */
function decideRound(summary) {
  if (summary.winner) return { winner: summary.winner, how: "play" };

  const [t1, t2] = summary.tiebreak || [0, 0];
  if (t1 !== t2) return { winner: t1 > t2 ? 1 : 2, how: "tiebreak" };

  const [l1, l2] = series.lives;
  if (l1 !== l2) return { winner: l1 < l2 ? 1 : 2, how: "underdog" };

  return { winner: Math.random() < 0.5 ? 1 : 2, how: "toss" };
}

// Applies a match result to the running series.
function applySeriesResult(summary) {
  const decision = decideRound(summary);
  series.lastDecision = decision;
  series.lastLost = decision.winner === 1 ? 1 : 0;
  series.lives[series.lastLost] -= 1;
  series.history.push({
    round: series.round,
    game: currentGame.title,
    winner: decision.winner,
    how: decision.how,
  });
  series.over = series.lives.some((lives) => lives <= 0);
}

function seriesChampion() {
  if (!series.over) return null;
  return series.lives[0] <= 0 ? 2 : 1;
}

// The round-by-round log shown when a gauntlet ends.
function buildSeriesLog() {
  const log = document.createElement("div");
  log.className = "series-log";
  log.replaceChildren(...series.history.map((entry) => {
    const row = document.createElement("div");
    row.className = "series-log-row";
    const color = entry.winner === 1 ? "var(--p1)" : "var(--p2)";
    row.style.setProperty("--accent", color);
    const mark = entry.how === "play" ? "" : entry.how === "tiebreak" ? " ·tb" : entry.how === "underdog" ? " ·cb" : " ·ct";
    row.innerHTML = `<span class="sl-round">R${String(entry.round).padStart(2, "0")}</span>
                     <span class="sl-game">${entry.game}</span>
                     <span class="sl-win" style="color:${color}">P${entry.winner}${mark}</span>`;
    return row;
  }));
  return log;
}

function renderSeriesStatus(summary) {
  const host = $("seriesStatus");
  if (playMode !== "gauntlet") { hide(host); return; }
  show(host);

  const head = document.createElement("span");
  head.className = "series-status-head";
  const how = series.lastDecision?.how;
  const decidedBy = how === "tiebreak" ? " ON TIEBREAK"
    : how === "underdog" ? " ON COUNTBACK"
    : how === "toss" ? " ON A COIN TOSS"
    : "";
  head.textContent = series.over
    ? `GAUNTLET DECIDED IN ${series.round} ${series.round === 1 ? "ROUND" : "ROUNDS"}`
    : `PLAYER ${series.lastLost + 1} LOSES A LIFE${decidedBy}`;

  const rows = document.createElement("div");
  rows.className = "series-status-rows";
  for (const side of [1, 2]) {
    const group = document.createElement("div");
    group.className = "series-status-side";
    const tag = document.createElement("span");
    tag.className = "series-tag";
    tag.dataset.side = String(side);
    tag.textContent = `P${side}`;
    const pips = document.createElement("span");
    pips.className = "lives";
    renderLives(pips, side, series.lives[side - 1], series.lastLost === side - 1);
    group.append(...(side === 1 ? [tag, pips] : [pips, tag]));
    rows.appendChild(group);
  }

  host.replaceChildren(head, rows);
}

function buildResultRow(row) {
  const el = document.createElement("div");
  el.className = "result-row";
  el.style.setProperty("--accent", row.color || "var(--p1)");
  el.innerHTML = `<span class="r-tag">${row.tag}</span>
                  <span class="r-text">${row.text}</span>
                  <span class="r-val">${row.value}</span>
                  <span class="r-track"><i></i></span>`;
  // Next frame, so the width transition actually animates from zero.
  requestAnimationFrame(() => {
    el.querySelector(".r-track i").style.width = `${clamp01(row.ratio ?? 0) * 100}%`;
  });
  return el;
}

function finish() {
  stopLoop();
  const summary = currentGame.getSummary();
  if (playMode === "gauntlet") applySeriesResult(summary);

  const champion = seriesChampion();
  const finale = playMode === "gauntlet" && series.over;

  const roundWinner = playMode === "gauntlet" ? series.lastDecision?.winner : null;
  $("gameOverTitle").textContent = finale
    ? `PLAYER ${champion} TAKES THE GAUNTLET`
    : roundWinner && summary.winner === null
      ? `PLAYER ${roundWinner} TAKES THE ROUND`
      : summary.title;
  const titleColor = finale ? (champion === 1 ? C.p1 : C.p2)
    : roundWinner && summary.winner === null ? (roundWinner === 1 ? C.p1 : C.p2)
    : summary.color || "";
  $("gameOverTitle").style.color = titleColor;
  $("gameOverTitle").style.textShadow = titleColor ? `0 0 34px ${titleColor}66` : "";

  document.querySelector(".result-kicker").textContent = finale
    ? "GAUNTLET COMPLETE"
    : playMode === "gauntlet"
      ? `ROUND ${series.round} RESULT`
      : summary.coop
        ? "DIVE COMPLETE"
        : "MATCH COMPLETE";

  const rows = $("gameOverLines");
  if (finale) rows.replaceChildren(buildSeriesLog());
  else rows.replaceChildren(...summary.rows.map(buildResultRow));

  renderSeriesStatus(summary);

  const replay = $("replayBtn");
  replay.textContent = finale ? "↻ NEW GAUNTLET"
    : playMode === "gauntlet" ? "▸ NEXT ROUND"
    : playMode === "shuffle" ? "⚄ DEAL AGAIN"
    : "↻ REMATCH";

  const note = $("recordNote");
  const best = getRecord(currentGame.id);
  if (Number.isFinite(summary.record) && summary.record > best) {
    setRecord(currentGame.id, summary.record);
    note.textContent = `★ NEW CHANNEL RECORD — ${summary.record}`;
    show(note);
    refreshRecords();
  } else {
    hide(note);
  }

  setState("over");
  renderSeriesBar(true);   // after setState, which re-renders the bar plainly
  startAutoNext();
  if (summary.coop) (summary.success ? sfx.win() : sfx.fail());
  else if (playMode !== "gauntlet" && summary.winner === null) sfx.draw();
  else sfx.win();
}

/* ── Hands-free round advance ────────────────────────────────────────
   In a gauntlet the players are standing back from the device, so the
   results screen rolls straight on to the next round by itself. The
   next round then opens with its own briefing, which waits for both
   players to be tracked — so the whole loop runs without anyone
   walking back to the keyboard.
   ─────────────────────────────────────────────────────────────────── */
const AUTO_NEXT_MS = 9000;
let autoTimer = null;
let autoDeadline = 0;

function startAutoNext() {
  if (playMode !== "gauntlet" || series.over) return;
  show($("autoNext"));
  autoDeadline = performance.now() + AUTO_NEXT_MS;

  const step = () => {
    autoTimer = null;
    if (state !== "over") { cancelAutoNext(); return; }
    const left = autoDeadline - performance.now();
    if (left <= 0) { cancelAutoNext(); nextRound(); return; }
    $("autoNextText").textContent = `NEXT ROUND IN ${Math.ceil(left / 1000)}`;
    $("autoBar").style.width = `${(left / AUTO_NEXT_MS) * 100}%`;
    autoTimer = setTimeout(step, 200);
  };
  step();
}

function cancelAutoNext() {
  if (autoTimer !== null) clearTimeout(autoTimer);
  autoTimer = null;
  hide($("autoNext"));
}

function returnToMenu() {
  sequenceToken++;
  finishWarmup();          // release any awaiting launch
  stopLoop();
  stopCamera();
  currentGame = null;
  selectedFactory = null;
  playMode = "single";
  resetSeries();
  cancelAutoNext();
  hide($("seriesStatus"));
  resetHudCache();
  hide(toast);
  ctx.clearRect(0, 0, view.width, view.height);
  setState("menu");
  measurePreviews();
  sfx.back();
}

function pause() {
  if (state !== "playing") return;
  stopLoop();
  setState("paused");
}

function resume() {
  if (state !== "paused") return;
  setState("playing");
  startLoop();
}

/* ── Wiring ──────────────────────────────────────────────────────── */
$("retryBtn").addEventListener("click", () => launch(selectedFactory));
$("replayBtn").addEventListener("click", () => primaryAction()());
$("menuBtn").addEventListener("click", returnToMenu);
$("errorMenuBtn").addEventListener("click", returnToMenu);
$("pauseMenuBtn").addEventListener("click", returnToMenu);
$("resumeBtn").addEventListener("click", resume);
$("briefSkipBtn").addEventListener("click", finishWarmup);
$("warmMenuBtn").addEventListener("click", returnToMenu);
quitBtn.addEventListener("click", () => (state === "playing" ? pause() : returnToMenu()));


$("gauntletBtn").addEventListener("click", startGauntlet);
$("shuffleBtn").addEventListener("click", startShuffle);

const muteBtn = $("muteBtn");
muteBtn.setAttribute("aria-pressed", String(isMuted()));
muteBtn.addEventListener("click", () => {
  unlock();
  setMuted(!isMuted());
  muteBtn.setAttribute("aria-pressed", String(isMuted()));
  if (!isMuted()) sfx.select();
});

$("fullBtn").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch(() => {});
});

document.addEventListener("keydown", (event) => {
  const key = event.key;
  if (key === "m" || key === "M") { muteBtn.click(); return; }
  if (key === "f" || key === "F") { $("fullBtn").click(); return; }

  if (state === "menu") {
    if (key === "ArrowRight" || key === "ArrowDown") { moveCursor(cursor + 1); cards[cursor].el.focus(); sfx.hover(); event.preventDefault(); }
    else if (key === "ArrowLeft" || key === "ArrowUp") { moveCursor(cursor - 1); cards[cursor].el.focus(); sfx.hover(); event.preventDefault(); }
    else if (key === "g" || key === "G") { startGauntlet(); }
    else if (key === "r" || key === "R") { startShuffle(); }
    else if (key === "Enter" || key === " ") {
      // A focused button already fires its own click for these keys.
      if (!event.target.closest?.(".channel, .mode-tile")) { startSingle(cards[cursor].factory); event.preventDefault(); }
    }
    else if (/^[1-9]$/.test(key) && cards[Number(key) - 1]) { moveCursor(Number(key) - 1); startSingle(cards[cursor].factory); }
    return;
  }

  if (state === "warmup" && (key === "Enter" || key === " ")) {
    finishWarmup();
    event.preventDefault();
    return;
  }

  if (key === "Escape") {
    if (state === "playing") pause();
    else if (state === "warmup") returnToMenu();
    else if (state === "paused" || state === "over" || state === "error") returnToMenu();
  } else if ((key === "p" || key === "P") && (state === "playing" || state === "paused")) {
    state === "playing" ? pause() : resume();
  } else if (key === "Enter" && state === "over") {
    primaryAction()();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
window.addEventListener("blur", pause);

// ResizeObserver rather than window.resize: the viewport also changes on
// fullscreen toggles and mobile URL-bar collapse, which fire no resize.
let resizeTimer = null;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    layout();
    measurePreviews();
    // Games bake geometry from the view size, so they must rebuild it.
    if (currentGame && (state === "playing" || state === "paused" || state === "countdown")) {
      currentGame.onResize?.(view);
    }
  }, 90);
}).observe(canvas);

/* ── Boot ────────────────────────────────────────────────────────── */
buildMenu();
buildFpsBars();
layout();
setState("menu");
document.querySelector('[data-led="power"]').classList.add("on");
cards[0]?.el.setAttribute("aria-current", "true");

const bootTime = performance.now();
setInterval(() => {
  const seconds = Math.floor((performance.now() - bootTime) / 1000);
  $("clockValue").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}, 1000);

// The shuffle tile's die keeps rolling while the menu is up.
const DICE = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
setInterval(() => {
  if (state !== "menu") return;
  const die = document.querySelector(".mode-dice");
  if (die) die.textContent = DICE[Math.floor(Math.random() * DICE.length)];
}, 900);

// Unlock audio on the first gesture anywhere.
["pointerdown", "keydown"].forEach((type) =>
  window.addEventListener(type, () => unlock(), { once: true, passive: true })
);
