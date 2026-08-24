// ============================================================
<<<<<<< Updated upstream
// SIGNAL POP — PvP — a motion-tracked local 2-player arcade game
//
// Pipeline (same as single-player, just two tracked hands now):
//   1. getUserMedia()            -> one shared webcam stream
//   2. MediaPipe HandLandmarker  -> up to 2 hands' landmarks per frame
//   3. Split by screen position  -> hand on left half = Player 1,
//                                    hand on right half = Player 2
//   4. Map to game coords        -> collision, scoring per side
//   5. Canvas 2D                 -> render bubbles/bombs + divider + cursors
//
// Everything below runs client-side. No server, no build step.
=======
// SIGNAL ARCADE — app shell
//
// This file owns everything that's the same across every game:
// the main menu, camera access, loading the right ML model, and
// running the per-frame loop. Each individual game only implements
// a small contract (see games/*.js) — that's what makes adding a
// new game later just "write one file + add it to GAMES below".
//
// Game module contract (see games/signalPop.js for a full example):
//   id, title, icon, blurb   -> shown on the menu card
//   mode: "hand" | "pose"    -> which tracking model this game needs
//   numHands (if mode="hand")-> 1 or 2
//   init({canvas, ctx, video})
//   onResults(results)       -> hand: array of hands' 21 landmarks
//                                pose: single pose's 33 landmarks (or null)
//   update(dt)
//   draw(ctx)
//   isOver()  -> boolean
//   getSummary() -> { title, color, lines: [] }
>>>>>>> Stashed changes
// ============================================================

import {
  HandLandmarker,
<<<<<<< Updated upstream
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

=======
  PoseLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

import { createSignalPop } from "./games/signalPop.js";
import { createWhackAMole } from "./games/whackAMole.js";
import { createCopyPose } from "./games/copyPose.js";
import { createIceBreaker } from "./games/iceBreaker.js";

const GAMES = [createSignalPop, createWhackAMole, createCopyPose, createIceBreaker];

>>>>>>> Stashed changes
// ---------- DOM ----------
const video = document.getElementById("webcam");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

<<<<<<< Updated upstream
const startScreen = document.getElementById("startScreen");
=======
const menuScreen = document.getElementById("menuScreen");
const menuGrid = document.getElementById("menuGrid");
>>>>>>> Stashed changes
const errorScreen = document.getElementById("errorScreen");
const loadingScreen = document.getElementById("loadingScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const errorMsg = document.getElementById("errorMsg");
<<<<<<< Updated upstream
const hud = document.getElementById("hud");
const score1El = document.getElementById("score1");
const score2El = document.getElementById("score2");
const timerEl = document.getElementById("timer");
const finalScore1El = document.getElementById("finalScore1");
const finalScore2El = document.getElementById("finalScore2");
const winnerTextEl = document.getElementById("winnerText");

document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("retryBtn").addEventListener("click", startGame);
document.getElementById("replayBtn").addEventListener("click", startGame);

// ---------- Game state ----------
let handLandmarker = null;
let running = false;
let score1 = 0; // player 1 = left half
let score2 = 0; // player 2 = right half
let timeLeft = 30;
let bubbles = [];
let lastSpawn = 0;
let timerInterval = null;

// fingertip cursors, one per side of the screen (spatial, not handedness)
let fingertipLeft = null;
let fingertipRight = null;

const BUBBLE_MIN_R = 20;
const BUBBLE_MAX_R = 38;
const SPAWN_EVERY_MS = 550;
const BOMB_CHANCE = 0.22; // ~1 in 4-5 spawns is a bomb
const BOMB_PENALTY = 5;
=======
const quitBtn = document.getElementById("quitBtn");
const gameOverTitle = document.getElementById("gameOverTitle");
const gameOverLines = document.getElementById("gameOverLines");

document.getElementById("retryBtn").addEventListener("click", () => startSelected());
document.getElementById("replayBtn").addEventListener("click", () => startSelected());
document.getElementById("menuBtn").addEventListener("click", returnToMenu);
quitBtn.addEventListener("click", returnToMenu);

// ---------- Build the menu from the GAMES registry ----------
let selectedFactory = null;

for (const factory of GAMES) {
  const meta = factory(); // throwaway instance just to read metadata
  const card = document.createElement("div");
  card.className = "game-card";
  card.innerHTML = `
    <div class="game-icon">${meta.icon}</div>
    <div class="game-title">${meta.title}</div>
    <div class="game-blurb">${meta.blurb}</div>
    <button class="game-play-btn">▶ PLAY</button>
  `;
  card.querySelector(".game-play-btn").addEventListener("click", () => {
    selectedFactory = factory;
    startSelected();
  });
  menuGrid.appendChild(card);
}
>>>>>>> Stashed changes

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

<<<<<<< Updated upstream
// ---------- Step 1: model loading (once) ----------
async function loadModel() {
=======
// ---------- Model caches (loaded lazily, reused across games) ----------
let handLandmarker = null;
let poseLandmarker = null;

async function getHandLandmarker() {
>>>>>>> Stashed changes
  if (handLandmarker) return handLandmarker;
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
<<<<<<< Updated upstream
    numHands: 2, // one per player
=======
    numHands: 2,
>>>>>>> Stashed changes
  });
  return handLandmarker;
}

<<<<<<< Updated upstream
// ---------- Step 2: camera ----------
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 960, height: 540 },
    audio: false,
  });
  video.srcObject = stream;
=======
async function getPoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });
  return poseLandmarker;
}

// ---------- Camera ----------
let cameraStream = null;

async function startCamera() {
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 960, height: 540 },
    audio: false,
  });
  video.srcObject = cameraStream;
>>>>>>> Stashed changes
  await new Promise((resolve) => (video.onloadedmetadata = resolve));
  video.play();
}

<<<<<<< Updated upstream
=======
function stopCamera() {
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
}

>>>>>>> Stashed changes
function resizeCanvasToScreen() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

<<<<<<< Updated upstream
// ---------- Full flow ----------
async function startGame() {
  hide(startScreen);
  hide(errorScreen);
  hide(gameOverScreen);
  show(loadingScreen);

  try {
    await startCamera();
    await loadModel();
=======
// ---------- Game lifecycle ----------
let currentGame = null;
let running = false;

async function startSelected() {
  if (!selectedFactory) return;

  hide(menuScreen);
  hide(errorScreen);
  hide(gameOverScreen);
  hide(quitBtn);
  show(loadingScreen);

  currentGame = selectedFactory();

  try {
    await startCamera();
    if (currentGame.mode === "pose") await getPoseLandmarker();
    else await getHandLandmarker();
>>>>>>> Stashed changes
  } catch (err) {
    console.error(err);
    hide(loadingScreen);
    errorMsg.textContent =
      err.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access and try again."
        : "Could not start camera or load the tracking model.";
    show(errorScreen);
    return;
  }

  resizeCanvasToScreen();
<<<<<<< Updated upstream
  hide(loadingScreen);
  show(hud);

  score1 = 0;
  score2 = 0;
  timeLeft = 30;
  bubbles = [];
  score1El.textContent = score1;
  score2El.textContent = score2;
  timerEl.textContent = timeLeft;
  running = true;

  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft -= 1;
    timerEl.textContent = timeLeft;
    if (timeLeft <= 0) endGame();
  }, 1000);

  requestAnimationFrame(gameLoop);
}

function endGame() {
  running = false;
  clearInterval(timerInterval);
  hide(hud);

  finalScore1El.textContent = score1;
  finalScore2El.textContent = score2;

  if (score1 > score2) {
    winnerTextEl.textContent = "PLAYER 1 WINS";
    winnerTextEl.style.color = "var(--p1)";
  } else if (score2 > score1) {
    winnerTextEl.textContent = "PLAYER 2 WINS";
    winnerTextEl.style.color = "var(--p2)";
  } else {
    winnerTextEl.textContent = "DRAW";
    winnerTextEl.style.color = "var(--amber)";
  }

  show(gameOverScreen);
  video.srcObject?.getTracks().forEach((t) => t.stop());
}

// ---------- Step 3: per-frame tracking -> split by screen side ----------
function detectHands(timestampMs) {
  fingertipLeft = null;
  fingertipRight = null;

  if (!handLandmarker || video.readyState < 2) return;
  const result = handLandmarker.detectForVideo(video, timestampMs);
  if (!result.landmarks || result.landmarks.length === 0) return;

  for (const lm of result.landmarks) {
    // landmark 8 = index fingertip. Values are normalized [0,1].
    const tip = lm[8];
    // mirror the x-axis to match the mirrored video element
    const x = (1 - tip.x) * canvas.width;
    const y = tip.y * canvas.height;

    // whichever half of the *screen* the fingertip lands in owns it —
    // this is spatial, not based on which hand (left/right) it is,
    // which is what makes standing side-by-side work naturally.
    if (x < canvas.width / 2) {
      fingertipLeft = { x, y };
    } else {
      fingertipRight = { x, y };
    }
  }
}

// ---------- Bubble / bomb spawning ----------
function spawnBubble() {
  const r = BUBBLE_MIN_R + Math.random() * (BUBBLE_MAX_R - BUBBLE_MIN_R);
  const isBomb = Math.random() < BOMB_CHANCE;
  // spawn anywhere across the full width; which side it's on determines
  // which player's hand can pop it
  bubbles.push({
    x: r + Math.random() * (canvas.width - 2 * r),
    y: canvas.height + r,
    r,
    vy: 55 + Math.random() * 65,
    type: isBomb ? "bomb" : Math.random() < 0.15 ? "amber" : "signal",
    popped: false,
    popT: 0,
  });
}

function updateBubbles(dt) {
  const now = performance.now();
  if (now - lastSpawn > SPAWN_EVERY_MS) {
    spawnBubble();
    lastSpawn = now;
  }

  for (const b of bubbles) {
    if (b.popped) {
      b.popT += dt;
      continue;
    }
    b.y -= b.vy * dt;

    const side = b.x < canvas.width / 2 ? "left" : "right";
    const fingertip = side === "left" ? fingertipLeft : fingertipRight;
    if (!fingertip) continue;

    const dx = fingertip.x - b.x;
    const dy = fingertip.y - b.y;
    if (Math.sqrt(dx * dx + dy * dy) < b.r + 14) {
      b.popped = true;
      b.popT = 0;

      let delta;
      if (b.type === "bomb") delta = -BOMB_PENALTY;
      else if (b.type === "amber") delta = 3;
      else delta = 1;

      if (side === "left") {
        score1 += delta;
        score1El.textContent = score1;
      } else {
        score2 += delta;
        score2El.textContent = score2;
      }
    }
  }

  bubbles = bubbles.filter((b) => {
    if (b.popped) return b.popT < 0.28; // keep briefly for pop animation
    return b.y + b.r > -20;
  });
}

// ---------- Step 4: render ----------
function colorFor(type) {
  if (type === "bomb") return "#ff3b3b";
  if (type === "amber") return "#ffb020";
  return "#35ff8f";
}

function drawDivider() {
  const x = canvas.width / 2;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, canvas.height);
  ctx.stroke();
  ctx.restore();
}

function drawBomb(b) {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.beginPath();
  ctx.arc(0, 0, b.r * 0.8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,59,59,0.15)";
  ctx.fill();
  ctx.strokeStyle = "#ff3b3b";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "#ff3b3b";
  ctx.shadowBlur = 14;
  ctx.stroke();
  // simple X mark so it reads as "danger" even on small screens
  const s = b.r * 0.35;
  ctx.beginPath();
  ctx.moveTo(-s, -s); ctx.lineTo(s, s);
  ctx.moveTo(s, -s); ctx.lineTo(-s, s);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawDivider();

  for (const b of bubbles) {
    if (b.popped) {
      const t = b.popT / 0.28;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (1 + t * 0.8), 0, Math.PI * 2);
      ctx.strokeStyle = colorFor(b.type);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      continue;
    }

    if (b.type === "bomb") {
      drawBomb(b);
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = colorFor(b.type);
      ctx.lineWidth = 2.5;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawCursor(fingertipLeft, "#35ff8f");
  drawCursor(fingertipRight, "#ff5fae");
}

function drawCursor(pt, color) {
  if (!pt) return;
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

=======
  currentGame.init({ canvas, ctx, video });

  hide(loadingScreen);
  show(quitBtn);
  running = true;
  lastFrameTime = performance.now();
  requestAnimationFrame(gameLoop);
}

function endCurrentGame() {
  running = false;
  stopCamera();
  hide(quitBtn);

  const summary = currentGame.getSummary();
  gameOverTitle.textContent = summary.title;
  gameOverTitle.style.color = summary.color || "";
  gameOverLines.innerHTML = summary.lines.map((l) => `<div>${l}</div>`).join("");
  show(gameOverScreen);
}

function returnToMenu() {
  running = false;
  stopCamera();
  hide(quitBtn);
  hide(gameOverScreen);
  hide(errorScreen);
  hide(loadingScreen);
  currentGame = null;
  selectedFactory = null;
  show(menuScreen);
}

// ---------- Per-frame tracking dispatch ----------
function detect(timestampMs) {
  if (video.readyState < 2) return;

  if (currentGame.mode === "pose") {
    if (!poseLandmarker) return;
    const result = poseLandmarker.detectForVideo(video, timestampMs);
    currentGame.onResults(result.landmarks && result.landmarks[0] ? result.landmarks[0] : null);
  } else {
    if (!handLandmarker) return;
    const result = handLandmarker.detectForVideo(video, timestampMs);
    currentGame.onResults(result.landmarks || []);
  }
}

>>>>>>> Stashed changes
// ---------- Main loop ----------
let lastFrameTime = performance.now();
function gameLoop(now) {
  if (!running) return;
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

<<<<<<< Updated upstream
  detectHands(now);
  updateBubbles(dt);
  draw();

=======
  detect(now);
  currentGame.update(dt);
  currentGame.draw(ctx);

  if (currentGame.isOver()) {
    endCurrentGame();
    return;
  }
>>>>>>> Stashed changes
  requestAnimationFrame(gameLoop);
}

window.addEventListener("resize", () => {
  if (running) resizeCanvasToScreen();
});
