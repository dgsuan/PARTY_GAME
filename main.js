import { HandLandmarker, PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { createSignalPop } from "./signalPop.js";
import { createWhackAMole } from "./whackAMole.js";
import { createCopyPose } from "./copyPose.js";
import { createIceBreaker } from "./iceBreaker.js";
import { mountPreview, startPreviews, stopPreviews, measurePreviews } from "./previews.js";
import { sfx, unlock, isMuted, setMuted } from "./audio.js";

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

const GAMES = [createSignalPop, createWhackAMole, createCopyPose, createIceBreaker];

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
const pauseScreen = $("pauseScreen");
const errorMsg = $("errorMsg");
const quitBtn = $("quitBtn");
const hud = $("hud");
const toast = $("toast");

const view = { width: 1, height: 1 };

let state = "menu";           // menu | loading | countdown | playing | paused | over | error
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
let noSubjectSince = 0;
let toastTimer = null;

/* ── Small DOM helpers ───────────────────────────────────────────── */
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");
const panels = () => [menuScreen, errorScreen, loadingScreen, gameOverScreen, countScreen, pauseScreen];

function setState(next) {
  state = next;
  for (const panel of panels()) hide(panel);
  hud.classList.add("hidden");
  quitBtn.classList.add("hidden");

  if (next === "menu") { show(menuScreen); startPreviews(); }
  else stopPreviews();

  if (next === "loading") show(loadingScreen);
  if (next === "error") show(errorScreen);
  if (next === "over") show(gameOverScreen);
  if (next === "paused") { show(pauseScreen); hud.classList.remove("hidden"); }
  if (next === "countdown") { show(countScreen); quitBtn.classList.remove("hidden"); }
  if (next === "playing") { hud.classList.remove("hidden"); quitBtn.classList.remove("hidden"); }

  $("modeValue").textContent = {
    menu: "IDLE", loading: "BOOT", countdown: "READY",
    playing: "LIVE", paused: "HOLD", over: "RESULT", error: "FAULT",
  }[next] || "IDLE";

  $("headChannel").textContent = currentGame && next !== "menu"
    ? `CH.${String(GAMES.findIndex((f) => f === selectedFactory) + 1).padStart(2, "0")}`
    : "CH.——";
  $("headTitle").textContent = currentGame && next !== "menu" ? currentGame.title : "CHANNEL SELECT";
}

function flash(message, ms = 2200) {
  toast.textContent = message;
  show(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(toast), ms);
}

/* ── Canvas sizing (HiDPI-correct) ───────────────────────────────── */
function layout() {
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
  const accents = ["var(--p1)", "var(--p2)", "var(--violet)", "var(--ice)"];
  GAMES.forEach((factory, index) => {
    const meta = factory();
    const card = document.createElement("button");
    card.type = "button";
    card.className = "channel";
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

    card.addEventListener("click", () => { moveCursor(index); launch(factory); });
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
  const instance = game.mode === "pose"
    ? await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numPoses: count,
      })
    : await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numHands: count,
      });
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

/* ── Launch sequence ─────────────────────────────────────────────── */
async function launch(factory) {
  unlock();
  sfx.select();
  selectedFactory = factory || selectedFactory;
  if (!selectedFactory) return;

  const token = ++sequenceToken;
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
  await countdown(token);
}

function countdown(token) {
  return new Promise((resolve) => {
    setState("countdown");
    $("countHint").textContent = currentGame.hint || "Step into frame";
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
const hudCache = { v1: null, v2: null, c: null, m1: null, m2: null, cl: null };
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
function finish() {
  stopLoop();
  const summary = currentGame.getSummary();

  $("gameOverTitle").textContent = summary.title;
  $("gameOverTitle").style.color = summary.color || "";
  $("gameOverTitle").style.textShadow = summary.color ? `0 0 34px ${summary.color}66` : "";

  const rows = $("gameOverLines");
  rows.replaceChildren(...summary.rows.map((row) => {
    const el = document.createElement("div");
    el.className = "result-row";
    el.style.setProperty("--accent", row.color || "var(--p1)");
    el.innerHTML = `<span class="r-tag">${row.tag}</span>
                    <span class="r-text">${row.text}</span>
                    <span class="r-val">${row.value}</span>
                    <span class="r-track"><i></i></span>`;
    requestAnimationFrame(() => {
      el.querySelector(".r-track i").style.width = `${clamp01(row.ratio ?? 0) * 100}%`;
    });
    return el;
  }));

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
  if (summary.title.includes("DRAW")) sfx.draw();
  else sfx.win();
}

function returnToMenu() {
  sequenceToken++;
  stopLoop();
  stopCamera();
  currentGame = null;
  selectedFactory = null;
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
$("replayBtn").addEventListener("click", () => launch(selectedFactory));
$("menuBtn").addEventListener("click", returnToMenu);
$("errorMenuBtn").addEventListener("click", returnToMenu);
$("pauseMenuBtn").addEventListener("click", returnToMenu);
$("resumeBtn").addEventListener("click", resume);
quitBtn.addEventListener("click", () => (state === "playing" ? pause() : returnToMenu()));

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
    else if (key === "Enter" || key === " ") {
      // A focused card button already fires its own click for these keys.
      if (!event.target.closest?.(".channel")) { launch(cards[cursor].factory); event.preventDefault(); }
    }
    else if (/^[1-9]$/.test(key) && cards[Number(key) - 1]) { moveCursor(Number(key) - 1); launch(cards[cursor].factory); }
    return;
  }

  if (key === "Escape") {
    if (state === "playing") pause();
    else if (state === "paused" || state === "over" || state === "error") returnToMenu();
  } else if ((key === "p" || key === "P") && (state === "playing" || state === "paused")) {
    state === "playing" ? pause() : resume();
  } else if (key === "Enter" && state === "over") {
    launch(selectedFactory);
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

// Unlock audio on the first gesture anywhere.
["pointerdown", "keydown"].forEach((type) =>
  window.addEventListener(type, () => unlock(), { once: true, passive: true })
);
