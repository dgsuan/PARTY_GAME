<<<<<<< Updated upstream
# Signal Pop — Motion-Tracked Arcade Game (Web, Local PvP)

A working example of an "Active Arcade"–style game: your webcam becomes the
controller. Two players stand side by side in front of **one shared
camera**, a dashed line splits the screen down the middle, and each player
pops glowing signals on their own half with their hand — no mouse, no
gamepad, no install. **Red bombs cost you 5 points if you pop them.**
Whoever has the higher score when the 30-second timer hits zero wins.
Runs entirely client-side, so it deploys as a static site.

## How the PvP split works

There's only one camera, so "Player 1" and "Player 2" aren't identified by
handedness — they're identified by **which half of the screen a hand is
in**. The hand-tracking model returns up to two sets of landmarks per
frame; each one gets bucketed into `fingertipLeft` or `fingertipRight`
based on its x-coordinate versus the canvas midpoint. A bubble spawned on
the left can only be popped by whatever hand is currently on the left —
so two people standing shoulder-to-shoulder naturally end up controlling
their own side, no calibration step needed.

## Is this actually possible?

Yes. Three browser-native pieces make it work, and all of them ship in
every modern browser (Chrome, Edge, Safari, mobile browsers included):

1. **`getUserMedia()`** — standard Web API, grabs the camera feed into a
   `<video>` element. No plugin needed.
2. **An in-browser ML model** — a small pose/hand-tracking neural net
   compiled to WebAssembly/WebGL runs *on the user's device* and outputs
   body/hand keypoints (x, y, confidence) for every video frame, live.
3. **Canvas/WebGL rendering** — you draw your game on top of those
   keypoints, just like you'd draw on top of mouse coordinates.

Nothing touches a server. That's exactly why it can be a static site on
Vercel or GitHub Pages — there's no backend to host.

## The workflow (general framework, applies to any camera game)

```
┌─────────────┐   ┌───────────────────┐   ┌────────────────────┐   ┌───────────┐
│ 1. Camera   │──▶│ 2. Landmark model  │──▶│ 3. Map to game      │──▶│ 4. Render │
│ getUserMedia│   │ (hands/pose/face)  │   │ coords + collisions │   │  canvas   │
└─────────────┘   └───────────────────┘   └────────────────────┘   └───────────┘
        ▲                                                                 │
        └─────────────────────── requestAnimationFrame loop ◀─────────────┘
```

1. **Capture** — ask for camera permission, pipe the stream into a hidden
   or visible `<video>` element.
2. **Track** — every animation frame, hand the current video frame to a
   landmark model. It returns normalized (0–1) coordinates for the parts
   you care about (fingertips, wrists, shoulders, nose, etc).
3. **Map & simulate** — convert those normalized coordinates into your
   canvas's pixel space (watch out for mirroring — see gotchas below),
   then run your normal game logic: collision checks, scoring, physics.
4. **Render** — draw the game on a `<canvas>` layered over (or in place
   of) the video. Repeat every frame via `requestAnimationFrame`.

This loop is identical whether you're tracking a hand to pop bubbles, a
whole body to dodge obstacles, or a face to steer a character — you just
swap which model and which landmarks you read.

## Framework / tech stack

| Piece | What we used | Why |
|---|---|---|
| Tracking model | **MediaPipe Tasks Vision** (`HandLandmarker`) via CDN | Google-maintained, runs on-device (WASM+GPU), zero backend, no npm install required — just an ES module import from a CDN |
| Rendering | Plain **Canvas 2D** | Simplest possible collision/drawing code; swap for WebGL/PixiJS/Three.js later if you want particle effects or 3D |
| App shell | **Vanilla HTML/CSS/JS**, no framework, no bundler | Zero build step — you can open `index.html` locally or drop the folder straight onto GitHub Pages/Vercel and it just works |

**When to graduate to something heavier:**
- Multiple game screens / menus / persistent state → add **React + Vite**
  (still deploys static; Vite outputs plain HTML/JS/CSS to `dist/`).
- Full-body games (dodge, squat, jump detection) → swap `HandLandmarker`
  for **`PoseLandmarker`** (33 body keypoints) — same API shape.
- Snappier physics/particles → **PixiJS** or **Matter.js** on top of the
  same landmark data.
- If you specifically want to clone more of Active Arcade's mechanics
  (jumping jacks, dodging, full-body games), PoseLandmarker is the one
  you want — I can build that version too if useful.

## Gotchas worth knowing up front

- **Mirroring**: webcams naturally show a "selfie" view. We mirror the
  video with CSS (`scaleX(-1)`) so it feels like a mirror, which means
  you must also flip the model's x-coordinates (`1 - x`) before using
  them for collision — otherwise your hand and the cursor move opposite
  directions. Already handled in `main.js`.
- **HTTPS required**: `getUserMedia()` only works on `https://` or
  `localhost`. Vercel and GitHub Pages both serve over HTTPS by default,
  so production is fine — just remember `localhost`, not `file://`, when
  testing locally.
- **Permissions are a user gesture**: browsers block camera access unless
  triggered by a real click/tap — that's why there's a "Play" button
  instead of auto-starting the camera on page load.
- **Model loading takes a moment**: the model file (~a few MB) loads
  from Google's CDN on first play; a loading screen covers that gap.
- **Performance**: `numHands: 1` keeps this light enough for laptops and
  most phones. Raise it if you want two-handed games.

## Files in this example

```
motion-arcade/
├── index.html   # page shell: video + canvas + game-state screens
├── style.css    # arcade-cabinet / CRT visual treatment
├── main.js      # camera setup, MediaPipe tracking, game loop
└── README.md    # this file
```

No `package.json`, no `node_modules` — it's plain static files.

## Run it locally

Because `getUserMedia` needs `https://` or `localhost`, don't just
double-click `index.html`. Serve it:

=======
# Signal Arcade — Motion-Tracked Web Games

A browser-based arcade with a main menu and four camera-controlled games.
No mouse, no gamepad — your hands (and body, for one game) are the
controller. Everything runs on-device via MediaPipe, so it deploys as a
static site with no backend.

## The games

| Game | Players | Tracking | How it works |
|---|---|---|---|
| **Signal Pop** | 2 (split screen) | 2 hands | Pop rising signals on your half for points; red bombs cost 5 points. Most points when the 30s timer ends wins. |
| **Whack-a-Mole** | 1 (uses both hands) | 2 hands | Moles pop up across a grid; whack them with either hand before they duck back down. Score as many as you can in 30s. |
| **Copy the Pose** | 1 | full body | A wall slides toward you showing a pose (arms up, T-pose, etc). Match it with your body to push it back and score. Miss 3 times and it's over — the wall gets faster every round. |
| **Ice Breaker** | 2 (split screen) | 2 hands | Hands become hammers. Smash every ice block on your half before your opponent smashes theirs. |

## Is this actually possible?

Yes — three browser-native pieces make it work in every modern browser:

1. **`getUserMedia()`** — grabs the camera feed into a `<video>` element.
2. **An in-browser ML model** — MediaPipe's `HandLandmarker` (21 points
   per hand) or `PoseLandmarker` (33 body points) runs *on the user's
   device* via WebAssembly/GPU and returns live keypoints every frame.
3. **Canvas rendering** — the game is drawn on top of those keypoints,
   exactly like drawing on top of mouse coordinates.

Nothing touches a server, which is why the whole thing can be a static
site on Vercel or GitHub Pages.

## Architecture — how the menu/game framework works

```
index.html + style.css        — shared shell: menu, camera, all overlays
main.js                       — app orchestrator (see contract below)
games/
  ├── utils.js                — shared math/drawing helpers
  ├── signalPop.js
  ├── whackAMole.js
  ├── copyPose.js
  └── iceBreaker.js
```

`main.js` owns everything every game needs in common:
- building the menu grid from a `GAMES` registry
- starting/stopping the camera
- loading the right ML model (`HandLandmarker` or `PoseLandmarker`,
  loaded once and cached — switching games doesn't reload the model
  unless it needs the *other* tracking type)
- running the `requestAnimationFrame` loop and feeding each game its
  landmarks every frame
- the generic loading / error / game-over screens

Each file in `games/` implements one small, self-contained contract —
nothing else. `main.js` never has any game-specific logic in it:

```js
export function createYourGame() {
  return {
    id: "yourgame",
    title: "Your Game",
    icon: "🎮",
    blurb: "One line describing it for the menu card",
    mode: "hand",       // or "pose"
    numHands: 2,         // only relevant if mode === "hand"

    init({ canvas, ctx, video }) { /* set up state */ },

    onResults(results) {
      // mode: "hand"  -> results = array of hands, each hand is
      //                  21 landmarks (MediaPipe hand model)
      // mode: "pose"  -> results = one pose's 33 landmarks, or null
    },

    update(dt) { /* advance game state by dt seconds */ },
    draw(ctx)  { /* render targets, cursors, and your own HUD text */ },
    isOver()   { return /* boolean */; },
    getSummary() {
      return { title: "GAME OVER", color: "#35ff8f", lines: ["Score: 12"] };
    },
  };
}
```

### Adding a fifth game
1. Create `games/yourGame.js` following the contract above.
2. In `main.js`, `import { createYourGame } from "./games/yourGame.js";`
   and add `createYourGame` to the `GAMES` array.

That's it — the menu card, camera setup, and model loading are all
handled automatically based on what you declare in `mode`/`numHands`.

## Design notes worth knowing

- **HUD lives on the canvas, not in HTML.** Every game draws its own
  score/timer/lives text directly with `ctx.fillText` in its `draw()`
  method. This keeps `index.html` generic — it doesn't need to know
  what any given game's HUD looks like.
- **Split-screen games (Signal Pop, Ice Breaker) don't track "left
  hand" vs "right hand."** They track *which half of the screen* a
  fingertip is in. Two players standing side by side in front of one
  camera naturally end up controlling their own half — no calibration
  step, no handedness detection needed.
- **Copy the Pose's pose-matching is heuristic, not exact.** It compares
  relative landmark positions (e.g. "both wrists above both shoulders"
  for ARMS UP) rather than precise joint angles. That's intentionally
  forgiving — exact angle-matching would feel unresponsive on a wide
  range of camera angles and body types.
- **Mirroring**: video is mirrored with CSS (`scaleX(-1)`) so it feels
  like a mirror. Every game flips landmark x-coordinates
  (`toCanvasPoint` in `utils.js`) to match — this is already handled,
  you don't need to think about it when adding a new hand/pose game.

## Gotchas

- **HTTPS required**: `getUserMedia()` only works on `https://` or
  `localhost`. Vercel and GitHub Pages both serve over HTTPS, so
  production is fine — just don't open `index.html` via `file://`.
- **Permissions need a user gesture**: that's why camera access only
  starts after clicking a game's Play button, not on page load.
- **First play per tracking type loads a model** (a few MB from
  Google's CDN) — the loading screen covers that gap. Switching
  between two hand-tracking games (e.g. Signal Pop → Whack-a-Mole)
  reuses the already-loaded model; switching to Copy the Pose loads
  the pose model the first time only.

## Run it locally

>>>>>>> Stashed changes
```bash
cd motion-arcade
python3 -m http.server 8000
# open http://localhost:8000
```
<<<<<<< Updated upstream

or with Node: `npx serve .`
=======
(or `npx serve .`)
>>>>>>> Stashed changes

## Deploy to GitHub Pages

```bash
git init
git add .
<<<<<<< Updated upstream
git commit -m "Signal Pop motion arcade game"
=======
git commit -m "Signal Arcade"
>>>>>>> Stashed changes
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
<<<<<<< Updated upstream
Then in the repo: **Settings → Pages → Deploy from branch → main / root**.
Your game will be live at `https://<you>.github.io/<repo>/`.
=======
Repo → **Settings → Pages → Deploy from branch → main / root**. Live at
`https://<you>.github.io/<repo>/`.
>>>>>>> Stashed changes

## Deploy to Vercel

```bash
<<<<<<< Updated upstream
npm i -g vercel   # one-time
cd motion-arcade
vercel
```
Since there's no build step, Vercel will auto-detect it as a static
site — accept the defaults and it deploys immediately. (Or connect the
GitHub repo in the Vercel dashboard for auto-deploys on push.)

## Tuning the PvP rules

All the knobs live at the top of `main.js`:

```js
const BUBBLE_MIN_R = 20;        // smallest target size
const BUBBLE_MAX_R = 38;        // largest target size
const SPAWN_EVERY_MS = 550;     // how often new targets appear
const BOMB_CHANCE = 0.22;       // ~22% of spawns are bombs
const BOMB_PENALTY = 5;         // points lost per bomb popped
```

Match length is set in `startGame()` (`timeLeft = 30`) — change to
whatever round length you want. Amber signals are worth 3 points,
regular green ones 1 point (see `updateBubbles()`).

## Extending the game

- **Per-hand instead of per-side**: if you'd rather lock each player to
  a specific physical hand (e.g. always their right hand) instead of
  "whichever hand is on my half," read `result.handedness` from the
  MediaPipe result alongside the landmarks.
- **Full-body dodge mode**: swap `HandLandmarker` for `PoseLandmarker`
  (33 body keypoints) and check wrist/shoulder/hip positions instead of
  just a fingertip — good for a "dodge the bomb" variant instead of "pop
  the bomb."
- **Sound**: add the Web Audio API on pop/bomb events for feedback —
  distinct tones for signal-pop vs bomb-hit read well even without
  looking at the score.
- **Best-of-N rounds**: wrap `startGame()`/`endGame()` in a round counter
  and keep a running series score across replays.
- **Leaderboard**: since this is static, wire up a lightweight backend
  (Supabase, Firebase, or a simple serverless function on Vercel) only
  if/when you want persistent scores — the local PvP game itself doesn't
  need one.
=======
npm i -g vercel
cd motion-arcade
vercel
```
No build step — Vercel detects it as static and deploys as-is. Or
connect the GitHub repo in the Vercel dashboard for auto-deploys.

## Tuning each game

All the gameplay constants live at the top of each game file:

- `games/signalPop.js` — `BOMB_CHANCE`, `BOMB_PENALTY`, `MATCH_TIME`
- `games/whackAMole.js` — `MOLE_UP_MS`, `MAX_ACTIVE`, grid size
- `games/copyPose.js` — `START_SPEED`, `SPEED_STEP`, `HOLD_TIME`, and
  the `POSES` array (add/remove poses here)
- `games/iceBreaker.js` — `COLS_PER_SIDE`, `ROWS`, `MAX_TIME`
>>>>>>> Stashed changes
