# Signal Arcade

A browser-based arcade with four camera-controlled games. Everything runs
on-device through MediaPipe; no backend or installation is required.

## Games

| Game | Players | Tracking |
| --- | --- | --- |
| Signal Pop | 2 | Two hands, split screen |
| Whack-a-Mole | 2 | Two hands, split screen |
| Copy the Pose | 2 | Two bodies, split screen |
| Ice Breaker | 2 | Two hands, split screen |

Each player owns a screen half. Signal Pop awards points for signals and
penalizes bombs. Whack-a-Mole awards points for moles hit on your side. Copy
the Pose gives each player three lives and a separate pose wall. Ice Breaker
is won by the player who breaks every block first.

## Run locally

Camera access requires `https://` or `localhost`; do not open the HTML file
directly from `file://`.

```bash
python -m http.server 8000
```

Open `http://localhost:8000` in a camera-capable browser and choose a game.
The first game using each tracking model downloads that model from the
MediaPipe CDN. Camera frames and landmarks stay in the browser.

## Files

```text
index.html       shared page shell
style.css        arcade styling
main.js          camera, model loading, menu, and game loop
utils.js         shared coordinate and drawing helpers
signalPop.js     two-player Signal Pop
whackAMole.js    two-player Whack-a-Mole
copyPose.js      two-player Copy the Pose
iceBreaker.js    two-player Ice Breaker
```

## Adding a game

Add a factory module exporting a game object with `init`, `onResults`,
`update`, `draw`, `isOver`, and `getSummary` methods. Register its factory in
the `GAMES` array in `main.js`, and set `mode` to `hand` or `pose`.

For hand games, `onResults` receives an array of 21-point hand landmarks.
For pose games, it receives an array of detected 33-point poses. Normalized
landmark coordinates can be converted with `toCanvasPoint` from `utils.js`.