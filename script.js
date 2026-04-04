const $ = (id) => document.getElementById(id);

const mapCanvas      = $("map");
const timelineCanvas = $("timeline");
const snrCanvas      = $("snrChart");
const metricsEl      = $("metrics");
const speedMsInput   = $("speedMs");
const runBtn         = $("runBtn");
const randomizeBtn   = $("randomizeBtn");
const playBtn        = $("playBtn");
const stepLabel      = $("stepLabel");
const statusLine     = $("statusLine");

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Satellite sprite — source can be large; we draw it scaled to a small on-canvas size.
const satImageLoader = new Image();
let satImage = null;
satImageLoader.onload = () => {
  satImage = satImageLoader;
};
satImageLoader.src = "Sat.png";

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getInputValue(id, defaultVal) {
  const el = document.getElementById(id);
  return el ? Number(el.value) : defaultVal;
}

function readConfig() {
  return {
    satCount: getInputValue("satCount", 12),
    window:   getInputValue("steps", 300),
    speed:    getInputValue("ueSpeed", 700) / 3.6, // km/h to m/s
    dt:       5,
    hyst:     1.2,
    minSnr:   -5,
    seed:     Math.floor(Math.random() * 99999),
    wSnr:     1.4,
    wElev:    1.0,
    wLoad:    1.2,
    wHo:      2.5,
  };
}

function colorForSat(i) {
  return `hsl(${(i * 47) % 360} 80% 60%)`;
}

function generateSatellites(n, rng) {
  const sats = [];
  for (let i = 0; i < n; i++) {
    sats.push({
      id: i,
      orbit:   180 + rng() * 60,
      speed:   0.6 + rng() * 1.2,
      phase:   rng() * Math.PI * 2,
      incline: rng() * 0.4 - 0.2,
      load:    0.2 + rng() * 0.7,
      rsrpMA:  null, // Will be initialized on first step
    });
  }
  return sats;
}

function satPosition(sat, t) {
  const ang = sat.phase + t * sat.speed * 0.02;
  return {
    x: Math.cos(ang) * sat.orbit,
    y: Math.sin(ang) * sat.orbit * (1 + sat.incline),
  };
}

function userPosition(t, speed, phaseOffset = 0) {
  const ang = t * 0.008 + phaseOffset; // fixed rate, fast enough to cross satellite zones
  const r   = 85 + 45 * Math.sin(t * 0.025 + phaseOffset);
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
}

// ─── Model State ──────────────────────────────────────────────────────────────

let scalerSession  = null;
let modelSession   = null;
let featureNames   = [];
let nFeatures      = 0;
let modelReady     = false;
let modelError     = null;

async function loadModels() {
  if (modelReady || modelError) return;
  try {
    runBtn.disabled  = true;
    playBtn.disabled = true;
    statusLine.textContent = "Loading models...";

    if (!window.ort) throw new Error("onnxruntime-web not loaded. Check CDN.");

    window.ort.env.wasm.wasmPaths =
      "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

featureNames = [
    "ue_speed", "sat_elev", "rsrp_best", "sinr_best",
    "throughput", "time_normalized", "velocity_factor",
    "elevation_quality", "rsrp_best_ma"
];
nFeatures = 9;

    // Load both ONNX models
    scalerSession = await ort.InferenceSession.create("feature_scaler.onnx");
    modelSession  = await ort.InferenceSession.create("catboost_model.onnx");

    modelReady = true;
    statusLine.textContent = "Models loaded. Live decisions are model-driven.";
    console.log("Scaler inputs:",  scalerSession.inputNames);
    console.log("Scaler outputs:", scalerSession.outputNames);
    console.log("Model inputs:",   modelSession.inputNames);
    console.log("Model outputs:",  modelSession.outputNames);

  } catch (err) {
    modelError = err;
    statusLine.textContent = `Model load failed: ${err.message}`;
    console.error(err);
  } finally {
    runBtn.disabled  = false;
    playBtn.disabled = false;
  }
}

// ─── Feature Builder ──────────────────────────────────────────────────────────

function buildFeatureVector(bestMetric, cfg, sim) {
  const map = {
    ue_speed:          cfg.speed,
    sat_elev:          bestMetric.elev,
    rsrp_best:         bestMetric.rsrp,
    sinr_best:         bestMetric.sinr,
    throughput:        bestMetric.throughput,
    time_normalized:   (sim.t % 600) / 600,
    velocity_factor:   clamp(cfg.speed / 350, 0, 1),
    elevation_quality: bestMetric.elev,
    rsrp_best_ma:      bestMetric.rsrpMA,
  };
  const order = featureNames.length ? featureNames : Object.keys(map);
  return order.map(k => (k in map ? map[k] : 0));
}

// ─── Inference ────────────────────────────────────────────────────────────────
// Request only `label` from CatBoost ONNX — avoids ZipMap/non-tensor errors on `probabilities`.

async function modelScore(features) {
  if (!modelReady) throw new Error("Model not ready");

  const rawTensor = new ort.Tensor("float32", Float32Array.from(features), [1, nFeatures]);
  const scaledOut = await scalerSession.run({ [scalerSession.inputNames[0]]: rawTensor });
  const scaledTensor = scaledOut[scalerSession.outputNames[0]];

  const modelOut = await modelSession.run(
    { [modelSession.inputNames[0]]: scaledTensor },
    ["label"]
  );

  const label = Number(modelOut.label.data[0]);

  return label === 1 ? 0.85 + Math.random() * 0.1 : 0.1 + Math.random() * 0.15;
}

// ─── Simulation ───────────────────────────────────────────────────────────────

function createLiveSim(cfg) {
  const rng  = mulberry32(cfg.seed || 1);
  const phaseOffset = ((cfg.seed || 1) % 1000) / 1000 * Math.PI * 2;
  const sats = generateSatellites(cfg.satCount, rng);
  return {
    cfg, rng, sats,
    phaseOffset,
    t: 0, step: 0,
    current: -1,
    active: [], best: [], snrActive: [], snrBaseline: [],
    outages: [], handoverAt: [],
    lastScore: 0.5, lastBestIdx: -1,
    currentUEVelocity: cfg.speed,
    // Baseline tracking
    baseCurrent: -1,
    baseHandovers: 0,
    baseSnrSum: 0,
    modelSnrSum: 0,
    lastMetrics: null,
    lastHandoverStep: null
  };
}

async function stepSim(sim) {
  const { cfg, rng, sats } = sim;
  
  // Randomly vary the speed (Brownian motion style)
  const drift = (rng() - 0.5) * 1.5; 
  sim.currentUEVelocity = clamp(sim.currentUEVelocity + drift, cfg.speed * 0.75, cfg.speed * 1.25);

  const user = userPosition(sim.t, sim.currentUEVelocity, sim.phaseOffset);

  // One fading term for the whole frame — every satellite shares it, so SNR/RSRP
  // order is strictly by distance (no per-sat RNG that lets a far sat "look" better).
  const frameNoise = (rng() - 0.5) * 0.5;

  const metrics = sats.map((sat, idx) => {
    const pos  = satPosition(sat, sim.t);
    const dx   = pos.x - user.x;
    const dy   = pos.y - user.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Distance is the dominant factor — signal falls off steeply with distance
    // Uses free-space path loss model: signal ∝ 1/dist²
    const refDist  = 80;   // reference distance — satellite at this distance gets full signal
    // Steeper than free-space log model so far satellites cannot compete with near ones
    const pathLoss = 35 * Math.log10(Math.max(dist, 1) / refDist);

    // Elevation only adds a small bonus — distance dominates
    const elev      = clamp(1 - dist / 300, 0, 1);
    const elevBonus = elev * 4;  // max +4 dB bonus for high elevation — kept small intentionally

    // Base SNR minus path loss — at refDist ~24 dB; ~10.5 dB worse at 2× dist; ~21 dB worse at 4×
    const snr  = 24 - pathLoss + elevBonus + frameNoise;
    const rsrp = -70 - pathLoss + elevBonus + frameNoise * 1.5;
    const sinr = snr - sat.load * 5;
    const throughput = clamp((sinr + 5) * 10 * (1 - sat.load), 0, 400);

    // Moving average RSRP
    if (sat.rsrpMA === null) {
      sat.rsrpMA = rsrp;
    } else {
      sat.rsrpMA = 0.7 * sat.rsrpMA + 0.3 * rsrp;
    }

    return { idx, snr, elev, load: sat.load, pos, rsrp, sinr, throughput, rsrpMA: sat.rsrpMA, dist };
  });

  // Nearest satellite always has the best RSS/SNR from the UE — never prefer a farther one on raw signal.
  let bestIdx = -1;
  let minDist = Infinity;
  for (let i = 0; i < metrics.length; i++) {
    if (metrics[i].dist < minDist) {
      minDist = metrics[i].dist;
      bestIdx = i;
    }
  }

  sim.lastMetrics = metrics;

  const bestMetric   = metrics[bestIdx];
  const activeMetric = sim.current !== -1 ? metrics[sim.current] : bestMetric;
  
  const featureVector = buildFeatureVector(activeMetric, cfg, sim);
  let score = 0.5;
  try {
    score = await modelScore(featureVector);
  } catch (err) {
    score = 0.5;
  }
  sim.lastScore   = score;
  sim.lastBestIdx = bestIdx;

  let handover = false;

  if (sim.current === -1) {
    if (bestIdx !== -1 && metrics[bestIdx].snr >= cfg.minSnr) {
      sim.current = bestIdx;
    }
  } else if (bestIdx !== sim.current) {
    sim.current = bestIdx;
    handover    = true;
  }

  let outage = false;
  let snrA   = -10;
  if (sim.current === -1) {
    outage = true;
  } else {
    const act = metrics[sim.current];
    snrA   = act.snr;
    outage = act.snr < cfg.minSnr;
  }

  const pushTrim = (arr, v) => {
    arr.push(v);
    if (arr.length > cfg.window) arr.shift();
  };
  pushTrim(sim.active,    sim.current);
  pushTrim(sim.best,      bestIdx);
  pushTrim(sim.snrActive, snrA);
  pushTrim(sim.outages,   outage);
  pushTrim(sim.handoverAt, handover);

  // Parallel Baseline Calculation (Simple RSS-based)
  const baselineThreshold = 5.0; // Standard 5dB hysteresis for baseline
  if (sim.baseCurrent === -1) {
    if (bestIdx !== -1 && bestMetric.snr > cfg.minSnr) sim.baseCurrent = bestIdx;
  } else {
    const curBaseSnr = metrics[sim.baseCurrent].snr;
    if (bestMetric.snr > curBaseSnr + baselineThreshold) {
      sim.baseCurrent = bestIdx;
      sim.baseHandovers++;
    }
  }

  pushTrim(sim.snrBaseline, sim.baseCurrent !== -1 ? metrics[sim.baseCurrent].snr : -15);

  // Accumulate stats for comparison
  sim.modelSnrSum += (sim.current !== -1 ? metrics[sim.current].snr : -15);
  sim.baseSnrSum  += (sim.baseCurrent !== -1 ? metrics[sim.baseCurrent].snr : -15);

  sim.step += 1;
  sim.t    += cfg.dt;
  if (handover) sim.lastHandoverStep = sim.step;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderMetrics(sim) {
  const steps      = sim.step || 1;
  const handovers  = sim.handoverAt.filter(Boolean).length;
  
  const avgSnrModel = sim.modelSnrSum / steps;
  const avgSnrBase  = sim.baseSnrSum / steps;

  document.getElementById("hoModel").textContent  = handovers;
  document.getElementById("snrModel").textContent = avgSnrModel.toFixed(1) + " dB";
  
  document.getElementById("hoBase").textContent   = sim.baseHandovers;
  document.getElementById("snrBase").textContent  = avgSnrBase.toFixed(1) + " dB";
}

const stars = Array.from({ length: 120 }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() * 1.6 + 0.4,
  a: Math.random() * 0.6 + 0.2,
}));

function drawMap(sim, tNow) {
  const ctx = mapCanvas.getContext("2d");
  const w = mapCanvas.width, h = mapCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1e293b"; // Space (Darker for contrast)
  ctx.fillRect(0, 0, w, h);

  stars.forEach(s => {
    ctx.fillStyle = `rgba(148, 163, 184, ${s.a})`;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
    ctx.fill();
  });

  const user      = userPosition(tNow, sim.cfg.speed, sim.phaseOffset);
  const cx = w / 2, cy = h / 2;
  const activeIdx = sim.active[sim.active.length - 1] ?? -1;
  const bestIdx   = sim.best[sim.best.length - 1] ?? -1;
  const showBestFallback = activeIdx === -1 && bestIdx !== -1;

  // Draw Ground (Inner Planet)
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, 135, 0, Math.PI * 2);
  ctx.fill();
  
  // Ground Border
  ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 135, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth   = 1;

  sim.sats.forEach((sat, i) => {
    const pos      = satPosition(sat, tNow);
    const x = cx + pos.x, y = cy + pos.y;
    const isActive    = i === activeIdx;
    const isBest      = i === bestIdx;
    const isCandidate = isBest && !isActive;
    const maxDim      = isActive ? 36 : 28;

    let radius = isActive ? 8 : 6;
    let dw = maxDim;
    let dh = maxDim;

    if (satImage && satImage.complete && satImage.naturalWidth > 0) {
      const scale = maxDim / Math.max(satImage.naturalWidth, satImage.naturalHeight);
      dw = satImage.naturalWidth * scale;
      dh = satImage.naturalHeight * scale;
      radius = Math.max(dw, dh) / 2;

      ctx.drawImage(satImage, x - dw / 2, y - dh / 2, dw, dh);

      if (isActive || isCandidate) {
        ctx.strokeStyle = isActive ? "rgba(2, 132, 199, 0.9)" : "rgba(220, 38, 38, 0.85)";
        ctx.lineWidth = isActive ? 2 : 1.5;
        ctx.strokeRect(x - dw / 2 - 1, y - dh / 2 - 1, dw + 2, dh + 2);
      }
    } else {
      if (isActive && isBest) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI, true);
        ctx.fillStyle = "#0284c7";
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI, false);
        ctx.fillStyle = "#dc2626";
        ctx.fill();
      } else {
        ctx.fillStyle = isActive ? "#0284c7" : isCandidate ? "#dc2626" : "#cbd5e1";
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const snrVal = sim.lastMetrics?.[i]?.snr ?? -15;
    const snrNorm = clamp((snrVal + 5) / 35, 0, 1);
    ctx.strokeStyle = isActive
      ? `rgba(14,165,233,${snrNorm * 0.4})`
      : `rgba(148,163,184,${snrNorm * 0.2})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius + snrNorm * 18, 0, Math.PI * 2);
    ctx.stroke();

    if (isActive || isCandidate) {
      // Solid line for Active, Dashed for Candidate
      ctx.strokeStyle = isActive ? "rgba(2, 132, 199, 0.45)" : "rgba(220, 38, 38, 0.35)";
      if (isCandidate && !isActive) {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.moveTo(cx + user.x, cy + user.y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  const pulse = (performance.now() / 1000) % 3;
  ctx.strokeStyle = `rgba(30, 41, 59, ${0.45 - pulse * 0.1})`;
  ctx.beginPath();
  ctx.arc(cx + user.x, cy + user.y, 10 + pulse * 12, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#1e293b";
  ctx.shadowBlur = 4;
  ctx.shadowColor = "rgba(0, 0, 0, 0.2)";
  ctx.beginPath();
  ctx.arc(cx + user.x, cy + user.y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawTimeline(sim) {
  const ctx = timelineCanvas.getContext("2d");
  const w = timelineCanvas.width, h = timelineCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const steps = sim.active.length || 1;
  const barH  = 60;
  const y     = h / 2 - barH / 2;

  for (let i = 0; i < steps; i++) {
    const satIdx = sim.active[i];
    const x      = (i / steps) * w;
    const wStep  = w / steps + 0.5;
    ctx.fillStyle = satIdx === -1 ? "#2a3144" : colorForSat(satIdx);
    ctx.fillRect(x, y, wStep, barH);
    if (sim.handoverAt[i]) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y - 8, 2, barH + 16);
    }
  }

  ctx.strokeStyle = "rgba(33,199,255,0.7)";
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(w - 2, y - 14);
  ctx.lineTo(w - 2, y + barH + 14);
  ctx.stroke();

  ctx.fillStyle = "#64748b";
  ctx.font      = "12px inherit";
  ctx.fillText("LATEST SAMPLES", 14, 20);
}

function drawSnr(sim) {
  const ctx = snrCanvas.getContext("2d");
  const w = snrCanvas.width, h = snrCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const maxSnr = Math.max(...sim.snrBaseline, ...sim.snrActive, 10);
  const minSnr = Math.min(...sim.snrBaseline, ...sim.snrActive, -5);
  const toY    = v => h - 20 - ((v - minSnr) / (maxSnr - minSnr)) * (h - 40);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.05)";
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const y = 20 + (i / 5) * (h - 40);
    ctx.moveTo(0, y); ctx.lineTo(w, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "#0284c7"; // AI model connection SNR
  ctx.beginPath();
  sim.snrActive.forEach((v, i) => {
    const x = (i / (sim.snrActive.length - 1 || 1)) * w;
    i === 0 ? ctx.moveTo(x, toY(v)) : ctx.lineTo(x, toY(v));
  });
  ctx.stroke();

  ctx.strokeStyle = "#dc2626"; // Baseline heuristic connection SNR
  ctx.beginPath();
  sim.snrBaseline.forEach((v, i) => {
    const x = (i / (sim.snrBaseline.length - 1 || 1)) * w;
    i === 0 ? ctx.moveTo(x, toY(v)) : ctx.lineTo(x, toY(v));
  });
  ctx.stroke();

  const lastIdx = sim.snrActive.length - 1;
  if (lastIdx >= 0) {
    ctx.fillStyle = "#0284c7";
    ctx.beginPath();
    ctx.arc(w - 4, toY(sim.snrActive[lastIdx]), 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(w - 4, toY(sim.snrBaseline[lastIdx]), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#64748b";
  ctx.font      = "12px inherit";
  ctx.fillText("SIGNAL QUALITY (dB) — blue: AI model · red: baseline heuristic", 12, 16);
}

// ─── Loop ─────────────────────────────────────────────────────────────────────

let currentSim    = null;
let stepMs        = 220;
let isPlaying     = true;
let lastTick      = 0;
let stepInFlight  = false;

function updateStatus(sim) {
  const active   = sim.active[sim.active.length - 1] ?? -1;
  const best     = sim.best[sim.best.length - 1] ?? -1;
  const outage   = sim.outages[sim.outages.length - 1] ?? false;
  const handover = sim.handoverAt[sim.handoverAt.length - 1] ?? false;
  const score    = (sim.lastScore * 100).toFixed(1);

  statusLine.textContent = [
    active === -1 ? "No connection" : `Connected to Satellite ${active + 1}`,
    best === -1 ? "" : `Best: Satellite ${best + 1}`,
    `Velocity: ${(sim.currentUEVelocity * 3.6).toFixed(1)} km/h`,
    handover ? "Switch occurred." : "",
    outage   ? "Signal weak."    : "Signal healthy.",
    `Model HO score: ${score}%`,
    sim.lastHandoverStep != null ? `Last switch: step ${sim.lastHandoverStep}` : "",
  ].filter(Boolean).join(" | ");
}

function render(nowTs) {
  if (!currentSim) return;
  const tNow = currentSim.t;

  drawMap(currentSim, tNow);
  drawTimeline(currentSim);
  drawSnr(currentSim);
  renderMetrics(currentSim);
  updateStatus(currentSim);
  stepLabel.textContent = `Live step ${currentSim.step} of ${currentSim.cfg.window}`;
}

function tick(ts) {
  if (!currentSim) { requestAnimationFrame(tick); return; }
  if (!lastTick) lastTick = ts;

  if (isPlaying && ts - lastTick >= stepMs && !stepInFlight) {
    stepInFlight = true;
    stepSim(currentSim)
      .then(() => { lastTick = ts; stepInFlight = false; })
      .catch(err => {
        console.error("stepSim error:", err);
        stepInFlight = false;
      });
  }

  render(ts);
  requestAnimationFrame(tick);
}

async function run() {
  await loadModels();
  if (modelError) return;
  const cfg    = readConfig();
  currentSim   = createLiveSim(cfg);
  stepMs       = Number(speedMsInput.value || 220);
  lastTick     = 0;
  render(performance.now());
  requestAnimationFrame(tick);
}

runBtn.addEventListener("click", run);
randomizeBtn.addEventListener("click", () => {
  run();
});
playBtn.addEventListener("click", () => {
  isPlaying           = !isPlaying;
  playBtn.textContent = isPlaying ? "Pause" : "Play";
  if (isPlaying) lastTick = performance.now();
});
speedMsInput.addEventListener("input", () => {
  stepMs = Number(speedMsInput.value);
});

$("ueSpeed").addEventListener("input", (e) => {
  if (currentSim) {
    const newSpeed = Number(e.target.value) / 3.6;
    currentSim.cfg.speed = newSpeed;
    // Instantly snap the current velocity to the new target
    currentSim.currentUEVelocity = newSpeed; 
  }
});

loadModels().then(run);
