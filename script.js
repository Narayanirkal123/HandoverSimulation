const $ = (id) => document.getElementById(id);

const mapCanvas = $("map");
const snrCanvas = $("snrChart");
const speedMsInput = $("speedMs");
const runBtn = $("runBtn");
const randomizeBtn = $("randomizeBtn");
const playBtn = $("playBtn");
const resetAllBtn = $("resetAllBtn");
const stepLabel = $("stepLabel");
const statusLine = $("statusLine");
const sidebarToggle = $("sidebarToggle");
const sidebar = $("controlSidebar");
const funModeToggle = $("funModeToggle");

const deterministicToggle = $("deterministicToggle");
const fixedSeedInput = $("fixedSeed");

const ueSpeedInput = $("ueSpeed");
const baselineHystInput = $("baselineHyst");
const ueSpeedVal = $("ueSpeedVal");
const baselineHystVal = $("baselineHystVal");
const speedMsVal = $("speedMsVal");

const healthModelState = $("healthModelState");
const healthLoadTime = $("healthLoadTime");
const healthInferLatency = $("healthInferLatency");
const healthLastInfer = $("healthLastInfer");

const summaryPanel = $("summaryPanel");
const summaryAiHo = $("summaryAiHo");
const summaryBaseHo = $("summaryBaseHo");
const summarySnrDelta = $("summarySnrDelta");
const summaryHoDelta = $("summaryHoDelta");

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const satImageLoader = new Image();
let satImage = null;
satImageLoader.onload = () => {
  satImage = satImageLoader;
};
satImageLoader.src = "Sat.png";

const defaultControls = {
  satCount: 12,
  ueSpeed: 700,
  steps: 300,
  baselineHyst: 5,
  speedMs: 220,
  deterministic: false,
  seed: 4242,
  funMode: true,
};

const funStatusLines = [
  "Orbit dance in progress.",
  "Signal handoff rhythm stable.",
  "Constellation sweep remains smooth.",
  "Tracking arc quality is clean.",
];

function updateSliderLabels() {
  if (ueSpeedVal) ueSpeedVal.textContent = ueSpeedInput ? ueSpeedInput.value : "-";
  if (baselineHystVal) {
    const h = baselineHystInput ? Number(baselineHystInput.value).toFixed(1) : "-";
    baselineHystVal.textContent = h;
  }
  if (speedMsVal) speedMsVal.textContent = speedMsInput ? speedMsInput.value : "-";
}

function setLoadingUi(loading, text) {
  if (runBtn) {
    runBtn.disabled = loading;
    runBtn.textContent = loading ? "Loading Models..." : "Start New Simulation";
  }
  if (playBtn) playBtn.disabled = loading;
  if (healthModelState && text) healthModelState.textContent = text;
}

function showSummary(sim) {
  if (!summaryPanel || !sim) return;
  const steps = Math.max(sim.step, 1);
  const aiHo = sim.handoverAt.filter(Boolean).length;
  const baseHo = sim.baseHandovers;
  const avgSnrModel = sim.modelSnrSum / steps;
  const avgSnrBase = sim.baseSnrSum / steps;
  const snrDelta = avgSnrModel - avgSnrBase;
  const hoReduction = baseHo - aiHo;

  summaryAiHo.textContent = String(aiHo);
  summaryBaseHo.textContent = String(baseHo);
  summarySnrDelta.textContent = `${snrDelta >= 0 ? "+" : ""}${snrDelta.toFixed(2)} dB`;
  summaryHoDelta.textContent = `${hoReduction >= 0 ? "+" : ""}${hoReduction}`;
  summaryPanel.classList.remove("hidden");
}

function hideSummary() {
  if (summaryPanel) summaryPanel.classList.add("hidden");
}

function setFunMode(enabled) {
  document.body.classList.toggle("fun-mode", Boolean(enabled));
}


function resetAllControls() {
  $("satCount").value = defaultControls.satCount;
  $("ueSpeed").value = defaultControls.ueSpeed;
  $("steps").value = defaultControls.steps;
  $("baselineHyst").value = defaultControls.baselineHyst;
  $("speedMs").value = defaultControls.speedMs;
  deterministicToggle.checked = defaultControls.deterministic;
  fixedSeedInput.value = defaultControls.seed;
  fixedSeedInput.disabled = !defaultControls.deterministic;
  funModeToggle.checked = defaultControls.funMode;
  setFunMode(defaultControls.funMode);
  updateSliderLabels();
  hideSummary();
  run();
}

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
  const deterministic = deterministicToggle ? deterministicToggle.checked : false;
  const fixedSeed = getInputValue("fixedSeed", 4242);
  return {
    satCount: getInputValue("satCount", 12),
    window: getInputValue("steps", 300),
    speed: getInputValue("ueSpeed", 700) / 3.6,
    baselineHyst: getInputValue("baselineHyst", 5.0),
    dt: 5,
    hyst: 1.2,
    minSnr: -5,
    seed: deterministic ? fixedSeed : Math.floor(Math.random() * 99999),
    wSnr: 1.4,
    wElev: 1.0,
    wLoad: 1.2,
    wHo: 2.5,
  };
}

function generateSatellites(n, rng) {
  const sats = [];
  for (let i = 0; i < n; i++) {
    sats.push({
      id: i,
      orbit: 180 + rng() * 60,
      speed: 0.6 + rng() * 1.2,
      phase: rng() * Math.PI * 2,
      incline: rng() * 0.4 - 0.2,
      load: 0.2 + rng() * 0.7,
      rsrpMA: null,
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

function userPosition(travel, phaseOffset = 0) {
  const ang = travel * 0.00021 + phaseOffset;
  const r = 85 + 45 * Math.sin(travel * 0.00064 + phaseOffset);
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
}

let scalerSession = null;
let modelSession = null;
let featureNames = [];
let nFeatures = 0;
let modelReady = false;
let modelError = null;
let loadTimeMs = null;
let lastInferMs = null;
let lastDecision = "-";

async function loadModels() {
  if (modelReady || modelError) return;
  try {
    const loadStart = performance.now();
    setLoadingUi(true, "Loading");
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

    scalerSession = await ort.InferenceSession.create("feature_scaler.onnx");
    modelSession = await ort.InferenceSession.create("catboost_model.onnx");

    modelReady = true;
    loadTimeMs = Math.round(performance.now() - loadStart);
    statusLine.textContent = "Models loaded. Live decisions are model-driven.";
    if (healthModelState) healthModelState.textContent = "Ready";
    if (healthLoadTime) healthLoadTime.textContent = `${loadTimeMs} ms`;
    console.log("Scaler inputs:", scalerSession.inputNames);
    console.log("Scaler outputs:", scalerSession.outputNames);
    console.log("Model inputs:", modelSession.inputNames);
    console.log("Model outputs:", modelSession.outputNames);
  } catch (err) {
    modelError = err;
    statusLine.textContent = `Model load failed: ${err.message}`;
    if (healthModelState) healthModelState.textContent = "Error";
    console.error(err);
  } finally {
    setLoadingUi(false, modelReady ? "Ready" : "Error");
  }
}

function buildFeatureVector(bestMetric, cfg, sim) {
  const map = {
    ue_speed: cfg.speed,
    sat_elev: bestMetric.elev,
    rsrp_best: bestMetric.rsrp,
    sinr_best: bestMetric.sinr,
    throughput: bestMetric.throughput,
    time_normalized: (sim.t % 600) / 600,
    velocity_factor: clamp(cfg.speed / 350, 0, 1),
    elevation_quality: bestMetric.elev,
    rsrp_best_ma: bestMetric.rsrpMA,
  };
  const order = featureNames.length ? featureNames : Object.keys(map);
  return order.map(k => (k in map ? map[k] : 0));
}

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

function createLiveSim(cfg) {
  const rng = mulberry32(cfg.seed || 1);
  const phaseOffset = ((cfg.seed || 1) % 1000) / 1000 * Math.PI * 2;
  const sats = generateSatellites(cfg.satCount, rng);
  return {
    cfg, rng, sats,
    phaseOffset,
    t: 0, step: 0,
    current: -1,
    active: [], best: [], snrActive: [], snrBaseline: [],
    outages: [], handoverAt: [], baseHandoverAt: [],
    lastScore: 0.5, lastBestIdx: -1,
    currentUEVelocity: cfg.speed,
    ueTravel: 0,
    baseCurrent: -1,
    baseHandovers: 0,
    baseSnrSum: 0,
    modelSnrSum: 0,
    lastMetrics: null,
    lastHandoverStep: null,
    completed: false,
  };
}

async function stepSim(sim) {
  const { cfg, rng, sats } = sim;

  const drift = (rng() - 0.5) * 1.5;
  sim.currentUEVelocity = clamp(sim.currentUEVelocity + drift, cfg.speed * 0.75, cfg.speed * 1.25);
  sim.ueTravel += sim.currentUEVelocity;

  const user = userPosition(sim.ueTravel, sim.phaseOffset);
  const frameNoise = (rng() - 0.5) * 0.5;

  const metrics = sats.map((sat, idx) => {
    const pos = satPosition(sat, sim.t);
    const dx = pos.x - user.x;
    const dy = pos.y - user.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const refDist = 80;
    const pathLoss = 35 * Math.log10(Math.max(dist, 1) / refDist);
    const elev = clamp(1 - dist / 300, 0, 1);
    const elevBonus = elev * 4;
    const snr = 24 - pathLoss + elevBonus + frameNoise;
    const rsrp = -70 - pathLoss + elevBonus + frameNoise * 1.5;
    const sinr = snr - sat.load * 5;
    const throughput = clamp((sinr + 5) * 10 * (1 - sat.load), 0, 400);

    if (sat.rsrpMA === null) {
      sat.rsrpMA = rsrp;
    } else {
      sat.rsrpMA = 0.7 * sat.rsrpMA + 0.3 * rsrp;
    }

    return { idx, snr, elev, load: sat.load, pos, rsrp, sinr, throughput, rsrpMA: sat.rsrpMA, dist };
  });

  let bestIdx = -1;
  let minDist = Infinity;
  for (let i = 0; i < metrics.length; i++) {
    if (metrics[i].dist < minDist) {
      minDist = metrics[i].dist;
      bestIdx = i;
    }
  }

  sim.lastMetrics = metrics;
  const bestMetric = metrics[bestIdx];
  const activeMetric = sim.current !== -1 ? metrics[sim.current] : bestMetric;

  const featureVector = buildFeatureVector(activeMetric, cfg, sim);
  let score = 0.5;
  try {
    const inferStart = performance.now();
    score = await modelScore(featureVector);
    lastInferMs = Math.round(performance.now() - inferStart);
    lastDecision = score >= 0.5 ? "Switch" : "Stay";
    if (healthInferLatency) healthInferLatency.textContent = `${lastInferMs} ms`;
    if (healthLastInfer) healthLastInfer.textContent = new Date().toLocaleTimeString();
  } catch (err) {
    score = 0.5;
  }
  sim.lastScore = score;
  sim.lastBestIdx = bestIdx;

  let handover = false;
  if (sim.current === -1) {
    if (bestIdx !== -1 && metrics[bestIdx].snr >= cfg.minSnr) {
      sim.current = bestIdx;
    }
  } else if (bestIdx !== sim.current) {
    sim.current = bestIdx;
    handover = true;
  }

  let outage = false;
  let snrA = -10;
  if (sim.current === -1) {
    outage = true;
  } else {
    const act = metrics[sim.current];
    snrA = act.snr;
    outage = act.snr < cfg.minSnr;
  }

  const pushTrim = (arr, v) => {
    arr.push(v);
    if (arr.length > cfg.window) arr.shift();
  };
  pushTrim(sim.active, sim.current);
  pushTrim(sim.best, bestIdx);
  pushTrim(sim.snrActive, snrA);
  pushTrim(sim.outages, outage);
  pushTrim(sim.handoverAt, handover);

  const baselineThreshold = cfg.baselineHyst;
  let baseHandover = false;
  if (sim.baseCurrent === -1) {
    if (bestIdx !== -1 && bestMetric.snr > cfg.minSnr) {
      sim.baseCurrent = bestIdx;
      baseHandover = true;
    }
  } else {
    const curBaseSnr = metrics[sim.baseCurrent].snr;
    if (bestIdx !== sim.baseCurrent && bestMetric.snr > curBaseSnr + baselineThreshold) {
      sim.baseCurrent = bestIdx;
      sim.baseHandovers++;
      baseHandover = true;
    }
  }
  pushTrim(sim.baseHandoverAt, baseHandover);
  pushTrim(sim.snrBaseline, sim.baseCurrent !== -1 ? metrics[sim.baseCurrent].snr : -15);

  sim.modelSnrSum += (sim.current !== -1 ? metrics[sim.current].snr : -15);
  sim.baseSnrSum += (sim.baseCurrent !== -1 ? metrics[sim.baseCurrent].snr : -15);

  sim.step += 1;
  sim.t += cfg.dt;
  if (handover) sim.lastHandoverStep = sim.step;
}

function renderMetrics(sim) {
  const steps = sim.step || 1;
  const handovers = sim.handoverAt.filter(Boolean).length;
  const avgSnrModel = sim.modelSnrSum / steps;
  const avgSnrBase = sim.baseSnrSum / steps;

  $("hoModel").textContent = handovers;
  $("snrModel").textContent = avgSnrModel.toFixed(1) + " dB";
  $("hoBase").textContent = sim.baseHandovers;
  $("snrBase").textContent = avgSnrBase.toFixed(1) + " dB";
}

const stars = Array.from({ length: 120 }, () => ({
  x: Math.random(), y: Math.random(),
  r: Math.random() * 1.6 + 0.4,
  a: Math.random() * 0.6 + 0.2,
}));

function drawMap(sim, tNow) {
  const ctx = mapCanvas.getContext("2d");
  const w = mapCanvas.width;
  const h = mapCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, w, h);

  stars.forEach(s => {
    ctx.fillStyle = `rgba(148, 163, 184, ${s.a})`;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
    ctx.fill();
  });

  const user = userPosition(sim.ueTravel, sim.phaseOffset);
  const cx = w / 2;
  const cy = h / 2;
  const activeIdx = sim.active[sim.active.length - 1] ?? -1;
  const bestIdx = sim.best[sim.best.length - 1] ?? -1;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, 135, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 135, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;

  sim.sats.forEach((sat, i) => {
    const pos = satPosition(sat, tNow);
    const x = cx + pos.x;
    const y = cy + pos.y;
    const isActive = i === activeIdx;
    const isBest = i === bestIdx;
    const isCandidate = isBest && !isActive;
    const maxDim = isActive ? 36 : 28;

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
      ctx.fillStyle = isActive ? "#0284c7" : isCandidate ? "#dc2626" : "#cbd5e1";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
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
      ctx.strokeStyle = isActive ? "rgba(2, 132, 199, 0.45)" : "rgba(220, 38, 38, 0.35)";
      if (isCandidate && !isActive) ctx.setLineDash([4, 4]);
      else ctx.setLineDash([]);
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
  ctx.beginPath();
  ctx.arc(cx + user.x, cy + user.y, 6, 0, Math.PI * 2);
  ctx.fill();
}

function drawSnr(sim) {
  const ctx = snrCanvas.getContext("2d");
  const w = snrCanvas.width;
  const h = snrCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  let actualMax = Math.max(...sim.snrBaseline, ...sim.snrActive);
  let actualMin = Math.min(...sim.snrBaseline, ...sim.snrActive);
  if (!isFinite(actualMax)) {
    actualMax = 10;
    actualMin = -5;
  }

  const span = actualMax - actualMin;
  const padding = Math.max(span * 0.1, 2);
  const maxSnr = actualMax + padding;
  const minSnr = actualMin - padding;
  const maxDelta = Math.max(maxSnr - minSnr, 1);
  const toY = (v) => h - 20 - ((v - minSnr) / maxDelta) * (h - 90);

  ctx.strokeStyle = "rgba(0, 0, 0, 0.05)";
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const y = 70 + (i / 5) * (h - 90);
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  const plotW = w - 40;
  const wStep = plotW / sim.cfg.window;
  const getX = (i) => i * wStep;

  ctx.strokeStyle = "#0284c7";
  ctx.beginPath();
  sim.snrActive.forEach((v, i) => {
    if (i === 0) ctx.moveTo(getX(i), toY(v));
    else ctx.lineTo(getX(i), toY(v));
  });
  ctx.stroke();

  ctx.strokeStyle = "#dc2626";
  ctx.beginPath();
  sim.snrBaseline.forEach((v, i) => {
    if (i === 0) ctx.moveTo(getX(i), toY(v));
    else ctx.lineTo(getX(i), toY(v));
  });
  ctx.stroke();

  const lastIdx = sim.snrActive.length - 1;
  if (lastIdx >= 0) {
    ctx.fillStyle = "#0284c7";
    ctx.beginPath();
    ctx.arc(getX(lastIdx), toY(sim.snrActive[lastIdx]), 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(getX(lastIdx), toY(sim.snrBaseline[lastIdx]), 6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#334155";
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "#0284c7";
  ctx.beginPath();
  ctx.arc(30, 26, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText("CatBoost Signal", 45, 32);

  ctx.fillStyle = "#dc2626";
  ctx.beginPath();
  ctx.arc(220, 26, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText("Baseline Signal", 235, 32);
}

let currentSim = null;
let stepMs = 220;
let isPlaying = true;
let lastTick = 0;
let stepInFlight = false;
let tickStarted = false;

function updateStatus(sim) {
  const active = sim.active[sim.active.length - 1] ?? -1;
  const best = sim.best[sim.best.length - 1] ?? -1;
  const outage = sim.outages[sim.outages.length - 1] ?? false;
  const handover = sim.handoverAt[sim.handoverAt.length - 1] ?? false;
  const score = (sim.lastScore * 100).toFixed(1);
  let message = [
    active === -1 ? "No connection" : `Connected to Satellite ${active + 1}`,
    best === -1 ? "" : `Best: Satellite ${best + 1}`,
    `Velocity: ${(sim.currentUEVelocity * 3.6).toFixed(1)} km/h`,
    handover ? "Switch occurred." : "",
    outage ? "Signal weak." : "Signal healthy.",
    `Model HO score: ${score}%`,
  ].filter(Boolean).join(" | ");

  if (funModeToggle && funModeToggle.checked && sim.step % 40 === 0 && sim.step > 0) {
    const note = funStatusLines[(sim.step / 40) % funStatusLines.length];
    message += ` | ${note}`;
  }
  statusLine.textContent = message;
}

function render() {
  if (!currentSim) return;
  const tNow = currentSim.t;
  drawMap(currentSim, tNow);
  drawSnr(currentSim);
  renderMetrics(currentSim);
  updateStatus(currentSim);
  stepLabel.textContent = `Live step ${currentSim.step} of ${currentSim.cfg.window}`;
}

function maybeCompleteSimulation(sim) {
  if (!sim || sim.completed) return;
  if (sim.step >= sim.cfg.window) {
    sim.completed = true;
    isPlaying = false;
    playBtn.textContent = "Play";
    showSummary(sim);
    statusLine.textContent = "Simulation complete. Review summary and export results if needed.";
  }
}

function tick(ts) {
  if (!currentSim) {
    requestAnimationFrame(tick);
    return;
  }
  if (!lastTick) lastTick = ts;

  if (isPlaying && ts - lastTick >= stepMs && !stepInFlight && !currentSim.completed) {
    stepInFlight = true;
    stepSim(currentSim)
      .then(() => {
        lastTick = ts;
        stepInFlight = false;
        maybeCompleteSimulation(currentSim);
      })
      .catch((err) => {
        console.error("stepSim error:", err);
        stepInFlight = false;
      });
  }

  render();
  requestAnimationFrame(tick);
}

async function run() {
  hideSummary();
  await loadModels();
  if (modelError) return;
  const cfg = readConfig();
  currentSim = createLiveSim(cfg);
  stepMs = Number(speedMsInput.value || 220);
  isPlaying = true;
  playBtn.textContent = "Pause Execution";
  lastTick = 0;
  render();
  if (!tickStarted) {
    tickStarted = true;
    requestAnimationFrame(tick);
  }
}

function onPlayToggle() {
  if (currentSim?.completed) {
    run();
    return;
  }
  isPlaying = !isPlaying;
  playBtn.textContent = isPlaying ? "Pause Execution" : "Play Execution";
  if (isPlaying) lastTick = performance.now();
}

function onDeterministicToggle() {
  fixedSeedInput.disabled = !deterministicToggle.checked;
}

function onSidebarToggle() {
  if (!sidebar) return;
  sidebar.classList.toggle("collapsed");
  const expanded = !sidebar.classList.contains("collapsed");
  sidebarToggle.setAttribute("aria-expanded", String(expanded));
}

runBtn.addEventListener("click", run);
randomizeBtn.addEventListener("click", run);
playBtn.addEventListener("click", onPlayToggle);
resetAllBtn.addEventListener("click", resetAllControls);
speedMsInput.addEventListener("input", () => {
  stepMs = Number(speedMsInput.value);
  updateSliderLabels();
});
ueSpeedInput.addEventListener("input", (e) => {
  updateSliderLabels();
  if (currentSim) {
    const newSpeed = Number(e.target.value) / 3.6;
    currentSim.cfg.speed = newSpeed;
    currentSim.currentUEVelocity = newSpeed;
  }
});
baselineHystInput.addEventListener("input", updateSliderLabels);
deterministicToggle.addEventListener("change", onDeterministicToggle);
sidebarToggle.addEventListener("click", onSidebarToggle);
funModeToggle.addEventListener("change", () => setFunMode(funModeToggle.checked));

updateSliderLabels();
onDeterministicToggle();
setFunMode(funModeToggle.checked);
loadModels().then(run);
