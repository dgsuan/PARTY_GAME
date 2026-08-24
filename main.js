import { HandLandmarker, PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
import { createSignalPop } from "./signalPop.js";
import { createWhackAMole } from "./whackAMole.js";
import { createCopyPose } from "./copyPose.js";
import { createIceBreaker } from "./iceBreaker.js";

const GAMES = [createSignalPop, createWhackAMole, createCopyPose, createIceBreaker];
const video = document.getElementById("webcam");
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const menuScreen = document.getElementById("menuScreen");
const menuGrid = document.getElementById("menuGrid");
const errorScreen = document.getElementById("errorScreen");
const loadingScreen = document.getElementById("loadingScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const errorMsg = document.getElementById("errorMsg");
const quitBtn = document.getElementById("quitBtn");
const gameOverTitle = document.getElementById("gameOverTitle");
const gameOverLines = document.getElementById("gameOverLines");

let selectedFactory = null;
let currentGame = null;
let running = false;
let cameraStream = null;
let handLandmarker = null;
let poseLandmarker = null;
let lastFrameTime = 0;

function show(element) { element.classList.remove("hidden"); }
function hide(element) { element.classList.add("hidden"); }

for (const factory of GAMES) {
  const meta = factory();
  const card = document.createElement("div");
  card.className = "game-card";
  card.innerHTML = `<div class="game-icon">${meta.icon}</div><div class="game-title">${meta.title}</div><div class="game-blurb">${meta.blurb}</div><button class="game-play-btn">&#9654; PLAY</button>`;
  card.querySelector(".game-play-btn").addEventListener("click", () => {
    selectedFactory = factory;
    startSelected();
  });
  menuGrid.appendChild(card);
}

async function getVision() {
  return FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
}

async function getHandLandmarker() {
  if (handLandmarker) return handLandmarker;
  const vision = await getVision();
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 2,
  });
  return handLandmarker;
}

async function getPoseLandmarker() {
  if (poseLandmarker) return poseLandmarker;
  const vision = await getVision();
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 2,
  });
  return poseLandmarker;
}

async function startCamera() {
  cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 960, height: 540 }, audio: false });
  video.srcObject = cameraStream;
  await new Promise((resolve) => { video.onloadedmetadata = resolve; });
  await video.play();
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  video.srcObject = null;
}

function resizeCanvasToScreen() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width));
  canvas.height = Math.max(1, Math.floor(rect.height));
}

async function startSelected() {
  if (!selectedFactory) return;
  hide(menuScreen); hide(errorScreen); hide(gameOverScreen); hide(quitBtn); show(loadingScreen);
  currentGame = selectedFactory();
  try {
    await startCamera();
    if (currentGame.mode === "pose") await getPoseLandmarker();
    else await getHandLandmarker();
  } catch (error) {
    console.error(error);
    stopCamera();
    hide(loadingScreen);
    errorMsg.textContent = error.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access and try again." : "Could not start camera or load the tracking model.";
    show(errorScreen);
    return;
  }
  resizeCanvasToScreen();
  currentGame.init({ canvas, ctx, video });
  hide(loadingScreen); show(quitBtn);
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
  gameOverLines.replaceChildren(...summary.lines.map((line) => {
    const element = document.createElement("div");
    element.textContent = line;
    return element;
  }));
  show(gameOverScreen);
}

function returnToMenu() {
  running = false;
  stopCamera();
  hide(quitBtn); hide(gameOverScreen); hide(errorScreen); hide(loadingScreen);
  currentGame = null; selectedFactory = null; show(menuScreen);
}

function detect(timestampMs) {
  if (!currentGame || video.readyState < 2) return;
  if (currentGame.mode === "pose") {
    const result = poseLandmarker.detectForVideo(video, timestampMs);
    currentGame.onResults(result.landmarks || []);
  } else {
    const result = handLandmarker.detectForVideo(video, timestampMs);
    currentGame.onResults(result.landmarks || []);
  }
}

function gameLoop(now) {
  if (!running || !currentGame) return;
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  detect(now);
  currentGame.update(dt);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  currentGame.draw(ctx);
  if (currentGame.isOver()) endCurrentGame();
  else requestAnimationFrame(gameLoop);
}

document.getElementById("retryBtn").addEventListener("click", startSelected);
document.getElementById("replayBtn").addEventListener("click", startSelected);
document.getElementById("menuBtn").addEventListener("click", returnToMenu);
quitBtn.addEventListener("click", returnToMenu);
window.addEventListener("resize", () => { if (running) resizeCanvasToScreen(); });