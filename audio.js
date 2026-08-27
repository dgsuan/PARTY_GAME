// Tiny WebAudio synth. No sample files — every sound is generated, so the
// whole app stays a handful of text files with no network assets.
// The AudioContext is created lazily on the first user gesture (browsers
// refuse to start one before that).

let ac = null;
let master = null;
let muted = readMuted();

function readMuted() {
  try { return localStorage.getItem("sa.muted") === "1"; } catch { return false; }
}

function ensure() {
  if (ac) return ac;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ac = new Ctor();
  master = ac.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ac.destination);
  return ac;
}

export function unlock() {
  const context = ensure();
  if (context && context.state === "suspended") context.resume();
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  try { localStorage.setItem("sa.muted", value ? "1" : "0"); } catch { /* ignore */ }
  if (master) master.gain.setTargetAtTime(value ? 0 : 0.5, ac.currentTime, 0.02);
}

function tone({ freq = 440, to = null, type = "sine", dur = 0.15, gain = 0.3, delay = 0 }) {
  const context = ensure();
  if (!context || muted) return;
  const t0 = context.currentTime + delay;
  const osc = context.createOscillator();
  const env = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Filtered noise burst — used for impacts (hammer, shattering ice).
function noise({ dur = 0.18, gain = 0.25, freq = 1400, q = 1.2, delay = 0, sweepTo = null }) {
  const context = ensure();
  if (!context || muted) return;
  const t0 = context.currentTime + delay;
  const frames = Math.floor(context.sampleRate * dur);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = context.createBufferSource();
  src.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(freq, t0);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  filter.Q.value = q;
  const env = context.createGain();
  env.gain.setValueAtTime(gain, t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(env).connect(master);
  src.start(t0);
}

export const sfx = {
  // menu / chrome
  hover: () => tone({ freq: 520, type: "triangle", dur: 0.05, gain: 0.06 }),
  select: () => { tone({ freq: 440, to: 880, type: "square", dur: 0.09, gain: 0.12 }); },
  back: () => tone({ freq: 400, to: 200, type: "triangle", dur: 0.12, gain: 0.12 }),

  // countdown
  count: () => tone({ freq: 660, type: "square", dur: 0.1, gain: 0.16 }),
  go: () => { tone({ freq: 880, type: "square", dur: 0.16, gain: 0.2 }); tone({ freq: 1320, type: "square", dur: 0.22, gain: 0.14, delay: 0.06 }); },

  // signal pop
  pop: (side) => tone({ freq: side === 0 ? 700 : 840, to: side === 0 ? 1250 : 1500, type: "sine", dur: 0.12, gain: 0.2 }),
  bonus: () => { tone({ freq: 880, type: "triangle", dur: 0.1, gain: 0.18 }); tone({ freq: 1320, type: "triangle", dur: 0.12, gain: 0.15, delay: 0.05 }); },
  bomb: () => { tone({ freq: 180, to: 45, type: "sawtooth", dur: 0.35, gain: 0.28 }); noise({ dur: 0.3, gain: 0.2, freq: 700, sweepTo: 120 }); },

  // whack
  whack: () => { noise({ dur: 0.1, gain: 0.3, freq: 1800, sweepTo: 400 }); tone({ freq: 160, to: 70, type: "square", dur: 0.09, gain: 0.16 }); },

  // ice breaker
  smash: () => { noise({ dur: 0.22, gain: 0.26, freq: 3200, sweepTo: 900, q: 0.8 }); tone({ freq: 1400, to: 500, type: "triangle", dur: 0.12, gain: 0.1 }); },

  // copy pose
  match: () => { tone({ freq: 620, type: "triangle", dur: 0.09, gain: 0.16 }); tone({ freq: 930, type: "triangle", dur: 0.14, gain: 0.13, delay: 0.06 }); },
  charge: () => tone({ freq: 300, to: 520, type: "sine", dur: 0.3, gain: 0.06 }),
  fail: () => { tone({ freq: 300, to: 90, type: "sawtooth", dur: 0.4, gain: 0.22 }); },

  // hull breach
  leak: () => noise({ dur: 0.4, gain: 0.16, freq: 2600, sweepTo: 5200, q: 0.7 }),
  seal: () => { tone({ freq: 520, to: 240, type: "sine", dur: 0.18, gain: 0.2 }); noise({ dur: 0.12, gain: 0.14, freq: 900, sweepTo: 300 }); },
  alarm: () => [0, 0.26].forEach((d) => { tone({ freq: 720, to: 480, type: "square", dur: 0.22, gain: 0.16, delay: d }); }),

  // results
  win: () => [0, 0.11, 0.22, 0.38].forEach((d, i) => tone({ freq: [523, 659, 784, 1047][i], type: "triangle", dur: 0.3, gain: 0.16, delay: d })),
  draw: () => [0, 0.12].forEach((d, i) => tone({ freq: [523, 523][i], type: "triangle", dur: 0.22, gain: 0.14, delay: d })),
};
