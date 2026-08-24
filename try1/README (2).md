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

```bash
cd motion-arcade
python3 -m http.server 8000
# open http://localhost:8000
```

or with Node: `npx serve .`

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Signal Pop motion arcade game"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
Then in the repo: **Settings → Pages → Deploy from branch → main / root**.
Your game will be live at `https://<you>.github.io/<repo>/`.

## Deploy to Vercel

```bash
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
