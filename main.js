// ============================================================
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
// ============================================================

import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// ---------- DOM ----------
const video = document.getElementById("webcam");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const startScreen = document.getElementById("startScreen");
const errorScreen = document.getElementById("errorScreen");
const loadingScreen = document.getElementById("loadingScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const errorMsg = document.getElementById("errorMsg");
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

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

// ---------- Step 1: model loading (once) ----------
async function loadModel() {
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
    numHands: 2, // one per player
  });
  return handLandmarker;
}

// ---------- Step 2: camera ----------
async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: 960, height: 540 },
    audio: false,
  });
  video.srcObject = stream;
  await new Promise((resolve) => (video.onloadedmetadata = resolve));
  video.play();
}

function resizeCanvasToScreen() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

// ---------- Full flow ----------
async function startGame() {
  hide(startScreen);
  hide(errorScreen);
  hide(gameOverScreen);
  show(loadingScreen);

  try {
    await startCamera();
    await loadModel();
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

// ---------- Main loop ----------
let lastFrameTime = performance.now();
function gameLoop(now) {
  if (!running) return;
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  detectHands(now);
  updateBubbles(dt);
  draw();

  requestAnimationFrame(gameLoop);
}

window.addEventListener("resize", () => {
  if (running) resizeCanvasToScreen();
});
