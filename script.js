const $ = (id) => document.getElementById(id);

const mapCanvas = $("map");
const speedMsInput = $("speedMs");
const runBtn = $("runBtn");
const randomizeBtn = $("randomizeBtn");
const playBtn = $("playBtn");
const resetAllBtn = $("resetAllBtn");
const stepLabel = $("stepLabel");
const statusLine = $("statusLine");
const sidebarToggle = $("sidebarToggle");
const sidebar = $("controlSidebar");
const deterministicToggle = $("deterministicToggle");
const fairEvalToggle = $("fairEvalToggle");
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

const modelStatusCat = $("modelStatusCat");
const modelStatusXgb = $("modelStatusXgb");
const modelStatusGbm = $("modelStatusGbm");

const hoCat = $("hoCat");
const snrCat = $("snrCat");
const hoXgb = $("hoXgb");
const snrXgb = $("snrXgb");
const hoGbm = $("hoGbm");
const snrGbm = $("snrGbm");

const hoCatBase = $("hoCatBase");
const snrCatBase = $("snrCatBase");
const hoXgbBase = $("hoXgbBase");
const snrXgbBase = $("snrXgbBase");
const hoGbmBase = $("hoGbmBase");
const snrGbmBase = $("snrGbmBase");

const summaryPanel = $("summaryPanel");

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const satImageLoader = new Image();
let satImage = null;
satImageLoader.onload = () => {
  satImage = satImageLoader;
};
satImageLoader.src = "Sat.png";

const FEATURE_NAMES = [
  "ue_speed",
  "sat_elev",
  "rsrp_best",
  "sinr_best",
  "throughput",
  "time_normalized",
  "velocity_factor",
  "elevation_quality",
  "rsrp_best_ma",
];
const N_FEATURES = FEATURE_NAMES.length;

const ENGINES = {
  cat: {
    key: "cat",
    label: "CatBoost",
    color: "#1169b8",
    metricIds: { ho: hoCat, snr: snrCat, hoBase: hoCatBase, snrBase: snrCatBase },
    chartId: "snrChartCat",
    statusEl: modelStatusCat,
    scalerPath: "feature_scaler.onnx",
    modelPath: "catboost_model.onnx",
    phaseOffset: 0.0,
    speedFactor: 1.0,
  },
  xgb: {
    key: "xgb",
    label: "XGBoost",
    color: "#7c3aed",
    metricIds: { ho: hoXgb, snr: snrXgb, hoBase: hoXgbBase, snrBase: snrXgbBase },
    chartId: "snrChartXgb",
    statusEl: modelStatusXgb,
    scalerPath: "xgb_scaler.onnx",
    modelPath: "xgb_model.onnx",
    phaseOffset: 1.9,
    speedFactor: 0.92,
  },
  gbm: {
    key: "gbm",
    label: "GradientBoost",
    color: "#ca8a04",
    metricIds: { ho: hoGbm, snr: snrGbm, hoBase: hoGbmBase, snrBase: snrGbmBase },
    chartId: "snrChartGbm",
    statusEl: modelStatusGbm,
    scalerPath: "gb_scaler.onnx",
    modelPath: "gb_model.onnx",
    phaseOffset: 3.7,
    speedFactor: 1.08,
  },
};

for (const engine of Object.values(ENGINES)) {
  engine.scalerSession = null;
  engine.modelSession = null;
  engine.ready = false;
  engine.pending = !engine.scalerPath || !engine.modelPath;
  engine.error = null;
  engine.loadMs = null;
  engine.lastInferMs = null;
  engine.lastInferAt = null;
}

const defaultControls = {
  satCount: 12,
  ueSpeed: 700,
  steps: 300,
  baselineHyst: 5,
  speedMs: 220,
  deterministic: false,
  fairEval: false,
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
  if (baselineHystVal) baselineHystVal.textContent = baselineHystInput ? Number(baselineHystInput.value).toFixed(1) : "-";
  if (speedMsVal) speedMsVal.textContent = speedMsInput ? speedMsInput.value : "-";
}

function setLoadingUi(loading) {
  if (runBtn) {
    runBtn.disabled = loading;
    runBtn.textContent = loading ? "Loading Models..." : "Start New Simulation";
  }
  if (playBtn) playBtn.disabled = loading;
}

function setFunMode(enabled) {
  document.body.classList.toggle("fun-mode", Boolean(enabled));
}

function setEnginePill(engine, text, pending = false) {
  if (!engine.statusEl) return;
  engine.statusEl.textContent = text;
  engine.statusEl.classList.toggle("pending", pending);
}

function updateModelHealthPanel() {
  const all = Object.values(ENGINES);
  const ready = all.filter((e) => e.ready).length;
  const pending = all.filter((e) => e.pending).length;
  const errors = all.filter((e) => e.error).length;

  if (healthModelState) {
    if (errors > 0) healthModelState.textContent = `${ready}/${all.length} Ready, ${errors} Error`;
    else if (pending > 0) healthModelState.textContent = `${ready}/${all.length} Ready, ${pending} Pending`;
    else healthModelState.textContent = `${ready}/${all.length} Ready`;
  }

  const loaded = all.filter((e) => e.loadMs !== null);
  if (healthLoadTime) {
    if (loaded.length === 0) healthLoadTime.textContent = "-";
    else {
      const total = loaded.reduce((s, e) => s + e.loadMs, 0);
      healthLoadTime.textContent = `${total} ms`;
    }
  }

  const inferred = all.filter((e) => e.lastInferMs !== null);
  if (healthInferLatency) {
    if (inferred.length === 0) healthInferLatency.textContent = "-";
    else {
      const avg = Math.round(inferred.reduce((s, e) => s + e.lastInferMs, 0) / inferred.length);
      healthInferLatency.textContent = `${avg} ms`;
    }
  }

  const latest = all
    .filter((e) => e.lastInferAt instanceof Date)
    .sort((a, b) => b.lastInferAt - a.lastInferAt)[0];
  if (healthLastInfer) healthLastInfer.textContent = latest ? latest.lastInferAt.toLocaleTimeString() : "-";
}

function resetMetricViews() {
  const all = Object.values(ENGINES);
  for (const e of all) {
    if (e.metricIds.ho) e.metricIds.ho.textContent = "-";
    if (e.metricIds.snr) e.metricIds.snr.textContent = "-";
    if (e.metricIds.hoBase) e.metricIds.hoBase.textContent = "-";
    if (e.metricIds.snrBase) e.metricIds.snrBase.textContent = "-";
  }
}

function hideSummary() {
  if (summaryPanel) summaryPanel.classList.add("hidden");
}

function showSummary(sim) {
  if (!summaryPanel || !sim) return;
  const candidates = Object.values(sim.agents).filter((a) => a.ready && a.stepCount > 0);
  if (candidates.length === 0) {
    hideSummary();
    return;
  }

  const grid = summaryPanel.querySelector('.summary-grid');
  if (grid) {
      grid.innerHTML = '';
      for (const a of candidates) {
        const avgSnr = a.snrSum / Math.max(a.stepCount, 1);
        const baseAvgSnr = a.baseline.snrSum / Math.max(a.baseline.stepCount, 1);
        grid.innerHTML += `
          <div class="summary-item">
              <span class="summary-label">${a.label} Final Results</span>
              <span class="summary-value" style="font-size: 0.82rem; line-height: 1.4;">
                AI: ${a.handovers} HO, ${avgSnr.toFixed(1)} dB<br>
                Base: ${a.baseline.handovers} HO, ${baseAvgSnr.toFixed(1)} dB
              </span>
          </div>
        `;
      }
  }

  summaryPanel.classList.remove("hidden");
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
    minSnr: -5,
    fairEval: fairEvalToggle ? fairEvalToggle.checked : true,
    seed: deterministic ? fixedSeed : Math.floor(Math.random() * 99999),
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
      rsrpMAByModel: {},
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

let modelLoadPromise = null;
let modelError = null;

async function loadEngineSessions(engine) {
  if (engine.pending) {
    setEnginePill(engine, "Pending Path", true);
    return;
  }
  const t0 = performance.now();
  setEnginePill(engine, "Loading", false);
  engine.scalerSession = await ort.InferenceSession.create(engine.scalerPath);
  engine.modelSession = await ort.InferenceSession.create(engine.modelPath);
  engine.ready = true;
  engine.loadMs = Math.round(performance.now() - t0);
  setEnginePill(engine, "Ready", false);
}

async function loadModels() {
  if (modelLoadPromise) {
    await modelLoadPromise;
    return;
  }
  modelLoadPromise = (async () => {
    try {
      setLoadingUi(true);
      statusLine.textContent = "Loading model sessions...";
      if (!window.ort) throw new Error("onnxruntime-web not loaded.");
      window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/";

      for (const engine of Object.values(ENGINES)) {
        try {
          await loadEngineSessions(engine);
        } catch (err) {
          engine.error = err;
          engine.ready = false;
          setEnginePill(engine, "Error", true);
        }
      }
      updateModelHealthPanel();
      const readyCount = Object.values(ENGINES).filter((e) => e.ready).length;
      if (readyCount === 0) {
        modelError = new Error("No model is ready. Provide valid ONNX paths.");
        statusLine.textContent = "No model ready. Provide paths for pending models.";
      } else {
        statusLine.textContent = `${readyCount} model(s) ready. You can run simulation now.`;
      }
    } catch (err) {
      modelError = err;
      statusLine.textContent = `Model load failed: ${err.message}`;
    } finally {
      setLoadingUi(false);
      updateModelHealthPanel();
      modelLoadPromise = null;
    }
  })();

  await modelLoadPromise;
}

function buildFeatureVector(metric, cfg, sim) {
  const map = {
    ue_speed: metric.currentUEVelocity,
    sat_elev: metric.elev,
    rsrp_best: metric.rsrp,
    sinr_best: metric.sinr,
    throughput: metric.throughput,
    time_normalized: (sim.t % 600) / 600,
    velocity_factor: clamp(metric.currentUEVelocity / 350, 0, 1),
    elevation_quality: metric.elev,
    rsrp_best_ma: metric.rsrpMA,
  };
  return FEATURE_NAMES.map((k) => (k in map ? map[k] : 0));
}

async function modelScore(engine, features) {
  const rawTensor = new ort.Tensor("float32", Float32Array.from(features), [1, N_FEATURES]);
  const scaledOut = await engine.scalerSession.run({ [engine.scalerSession.inputNames[0]]: rawTensor });
  const scaledTensor = scaledOut[engine.scalerSession.outputNames[0]];
  const modelOut = await engine.modelSession.run({ [engine.modelSession.inputNames[0]]: scaledTensor });

  const labelTensor = modelOut.label || modelOut[engine.modelSession.outputNames[0]];
  const label = labelTensor && labelTensor.data && labelTensor.data.length
    ? Number(labelTensor.data[0])
    : 0;

  let confidence = label === 1 ? 1 : 0;
  for (const value of Object.values(modelOut)) {
    try {
      if (value && value.data && value.data.length >= 2) {
        const p0 = Number(value.data[0]);
        const p1 = Number(value.data[1]);
        if (Number.isFinite(p0) && Number.isFinite(p1)) {
          confidence = p1;
          break;
        }
      }
    } catch {
      // Ignore non-tensor properties that throw when data is accessed
    }
  }

  confidence = clamp(confidence, 0, 1);
  return { label, confidence };
}

function createLiveSim(cfg) {
  const rng = mulberry32(cfg.seed || 1);
  const sats = generateSatellites(cfg.satCount, rng);
  const agents = {};
  const sharedPhaseOffset = ((cfg.seed || 1) % 1000) / 1000 * Math.PI * 2;
  const sharedUserPos = userPosition(0, sharedPhaseOffset);

  for (const engine of Object.values(ENGINES)) {
    agents[engine.key] = {
      key: engine.key,
      label: engine.label,
      color: engine.color,
      ready: engine.ready,
      current: -1,
      handovers: 0,
      snrSum: 0,
      stepCount: 0,
      currentUEVelocity: cfg.speed * engine.speedFactor,
      ueTravel: 0,
      phaseOffset: engine.phaseOffset,
      snrSeries: [],
      lastScore: null,
      lastDecisionLabel: 0,
      activeSeries: [],
      bestSeries: [],
      currentPos: cfg.fairEval ? { ...sharedUserPos } : { x: 0, y: 0 },
      baseline: {
        current: -1,
        handovers: 0,
        snrSum: 0,
        stepCount: 0,
        snrSeries: [],
      },
    };
  }

  return {
    cfg,
    rng,
    sats,
    agents,
    t: 0,
    step: 0,
    sharedUEVelocity: cfg.speed,
    sharedUETravel: 0,
    sharedPhaseOffset,
    sharedUserPos,
    completed: false,
    lastStepRuntimeMs: null,
  };
}

async function stepSim(sim) {
  const tStart = performance.now();
  const frameNoise = (sim.rng() - 0.5) * 0.5;
  const fairEval = Boolean(sim.cfg.fairEval);

  if (fairEval) {
    const drift = (sim.rng() - 0.5) * 1.5;
    sim.sharedUEVelocity = clamp(
      sim.sharedUEVelocity + drift,
      sim.cfg.speed * 0.75,
      sim.cfg.speed * 1.25
    );
    sim.sharedUETravel += sim.sharedUEVelocity;
    sim.sharedUserPos = userPosition(sim.sharedUETravel, sim.sharedPhaseOffset);
  }

  for (const engine of Object.values(ENGINES)) {
    const agent = sim.agents[engine.key];
    if (!agent.ready) continue;

    if (fairEval) {
      agent.currentUEVelocity = sim.sharedUEVelocity;
      agent.ueTravel = sim.sharedUETravel;
      agent.currentPos = sim.sharedUserPos;
    } else {
      const drift = (sim.rng() - 0.5) * 1.5;
      const baseSpeed = sim.cfg.speed * engine.speedFactor;
      agent.currentUEVelocity = clamp(agent.currentUEVelocity + drift, baseSpeed * 0.75, baseSpeed * 1.25);
      agent.ueTravel += agent.currentUEVelocity;
      agent.currentPos = userPosition(agent.ueTravel, agent.phaseOffset);
    }
    const user = agent.currentPos;

    const metrics = sim.sats.map((sat) => {
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

      if (sat.rsrpMAByModel[engine.key] === undefined) sat.rsrpMAByModel[engine.key] = rsrp;
      else sat.rsrpMAByModel[engine.key] = 0.7 * sat.rsrpMAByModel[engine.key] + 0.3 * rsrp;

      return { snr, elev, rsrp, sinr, throughput, rsrpMA: sat.rsrpMAByModel[engine.key], dist, pos };
    });

    let bestIdx = -1;
    let minDist = Infinity;
    for (let i = 0; i < metrics.length; i++) {
      if (metrics[i].dist < minDist) {
        minDist = metrics[i].dist;
        bestIdx = i;
      }
    }

    const activeMetric = agent.current !== -1 ? metrics[agent.current] : metrics[bestIdx];
    const features = buildFeatureVector({ ...activeMetric, currentUEVelocity: agent.currentUEVelocity }, sim.cfg, sim);
    agent.lastMetrics = metrics;
    agent.lastBestIdx = bestIdx;

    try {
      const inferStart = performance.now();
      const out = await modelScore(engine, features);
      agent.lastDecisionLabel = out.label;
      agent.lastScore = out.confidence;
      engine.lastInferMs = Math.round(performance.now() - inferStart);
      engine.lastInferAt = new Date();
    } catch (err) {
      agent.lastDecisionLabel = 0;
      agent.lastScore = null;
      agent.lastError = err.message || String(err);
    }

    if (agent.current === -1 && bestIdx !== -1 && metrics[bestIdx].snr >= sim.cfg.minSnr) {
      agent.current = bestIdx;
    } else if (bestIdx !== -1 && bestIdx !== agent.current) {
      agent.current = bestIdx;
      agent.handovers += 1;
    }

    const snrA = agent.current === -1 ? -10 : metrics[agent.current].snr;
    agent.snrSeries.push(snrA);
    if (agent.snrSeries.length > sim.cfg.window) agent.snrSeries.shift();
    agent.activeSeries.push(agent.current);
    if (agent.activeSeries.length > sim.cfg.window) agent.activeSeries.shift();
    agent.bestSeries.push(bestIdx);
    if (agent.bestSeries.length > sim.cfg.window) agent.bestSeries.shift();

    agent.snrSum += snrA;
    agent.stepCount += 1;

    const base = agent.baseline;
    if (base.current === -1) {
      if (bestIdx !== -1 && metrics[bestIdx].snr >= sim.cfg.minSnr) {
        base.current = bestIdx;
      }
    } else if (bestIdx !== -1 && bestIdx !== base.current) {
      const curSnr = metrics[base.current].snr;
      const bestSnr = metrics[bestIdx].snr;
      if (bestSnr > curSnr + sim.cfg.baselineHyst) {
        base.current = bestIdx;
        base.handovers += 1;
      }
    }

    const snrB = base.current === -1 ? -10 : metrics[base.current].snr;
    base.snrSeries.push(snrB);
    if (base.snrSeries.length > sim.cfg.window) base.snrSeries.shift();
    base.snrSum += snrB;
    base.stepCount += 1;
  }

  sim.step += 1;
  sim.t += sim.cfg.dt;
  sim.lastStepRuntimeMs = Math.round(performance.now() - tStart);
  updateModelHealthPanel();
}

function renderMetrics(sim) {
  for (const engine of Object.values(ENGINES)) {
    const agent = sim.agents[engine.key];
    if (!agent || !agent.ready || agent.stepCount === 0) {
      if (engine.metricIds.ho) engine.metricIds.ho.textContent = "-";
      if (engine.metricIds.snr) engine.metricIds.snr.textContent = "-";
      if (engine.metricIds.hoBase) engine.metricIds.hoBase.textContent = "-";
      if (engine.metricIds.snrBase) engine.metricIds.snrBase.textContent = "-";
      continue;
    }
    const avgSnr = agent.snrSum / agent.stepCount;
    const baseAvgSnr = agent.baseline.snrSum / Math.max(agent.baseline.stepCount, 1);
    if (engine.metricIds.ho) engine.metricIds.ho.textContent = String(agent.handovers);
    if (engine.metricIds.snr) engine.metricIds.snr.textContent = `${avgSnr.toFixed(1)} dB`;
    if (engine.metricIds.hoBase) engine.metricIds.hoBase.textContent = String(agent.baseline.handovers);
    if (engine.metricIds.snrBase) engine.metricIds.snrBase.textContent = `${baseAvgSnr.toFixed(1)} dB`;
  }
}

const stars = Array.from({ length: 120 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: Math.random() * 1.6 + 0.4,
  a: Math.random() * 0.6 + 0.2,
}));

function drawMap(sim, tNow) {
  const ctx = mapCanvas.getContext("2d");
  const w = mapCanvas.width;
  const h = mapCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(0, 0, w, h);

  stars.forEach((s) => {
    ctx.fillStyle = `rgba(148, 163, 184, ${s.a})`;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy, 135, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(30,41,59,0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 135, 0, Math.PI * 2);
  ctx.stroke();

  const satPositions = sim.sats.map((sat) => satPosition(sat, tNow));
  satPositions.forEach((p) => {
    const x = cx + p.x;
    const y = cy + p.y;
    const maxDim = 28;
    if (satImage && satImage.complete && satImage.naturalWidth > 0) {
      const scale = maxDim / Math.max(satImage.naturalWidth, satImage.naturalHeight);
      const dw = satImage.naturalWidth * scale;
      const dh = satImage.naturalHeight * scale;
      ctx.drawImage(satImage, x - dw / 2, y - dh / 2, dw, dh);
    } else {
      ctx.fillStyle = "#cbd5e1";
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const fairEval = Boolean(sim.cfg.fairEval);
  for (const engine of Object.values(ENGINES)) {
    const agent = sim.agents[engine.key];
    if (!agent || !agent.ready) continue;
    const pos = fairEval ? sim.sharedUserPos : agent.currentPos;
    const ux = cx + pos.x;
    const uy = cy + pos.y;
    const activeSat = agent.current;
    if (activeSat !== -1) {
      const satPos = satPositions[activeSat];
      ctx.strokeStyle = engine.color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(ux, uy);
      ctx.lineTo(cx + satPos.x, cy + satPos.y);
      ctx.stroke();
    }

    if (!fairEval) {
      ctx.fillStyle = engine.color;
      ctx.beginPath();
      ctx.arc(ux, uy, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (fairEval) {
    const ux = cx + sim.sharedUserPos.x;
    const uy = cy + sim.sharedUserPos.y;
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.arc(ux, uy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(ux, uy, 9, 0, Math.PI * 2);
    ctx.stroke();
  }

}

function drawSnr(sim) {
  const readyAgents = Object.values(sim.agents).filter((a) => a.ready);
  
  for (const engine of Object.values(ENGINES)) {
    const agent = sim.agents[engine.key];
    const canvas = document.getElementById(engine.chartId);
    if (!canvas || !agent || !agent.ready || agent.snrSeries.length === 0) continue;
    
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    
    const allValues = [...agent.snrSeries, ...agent.baseline.snrSeries];
    let actualMax = allValues.length ? Math.max(...allValues) : 10;
    let actualMin = allValues.length ? Math.min(...allValues) : -5;
    const span = actualMax - actualMin;
    const padding = Math.max(span * 0.1, 2);
    const maxSnr = actualMax + padding;
    const minSnr = actualMin - padding;
    const maxDelta = Math.max(maxSnr - minSnr, 1);
    const toY = (v) => h - 20 - ((v - minSnr) / maxDelta) * (h - 40);

    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const y = 20 + (i / 5) * (h - 40);
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    const plotW = w - 40;
    const wStep = plotW / Math.max(sim.cfg.window, 1);

    if (agent.baseline.snrSeries.length > 0) {
      ctx.strokeStyle = "#b83d31";
      ctx.lineWidth = 2.0;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      agent.baseline.snrSeries.forEach((v, i) => {
        const x = i * wStep;
        if (i === 0) ctx.moveTo(x, toY(v));
        else ctx.lineTo(x, toY(v));
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = engine.color;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    agent.snrSeries.forEach((v, i) => {
      const x = i * wStep;
      if (i === 0) ctx.moveTo(x, toY(v));
      else ctx.lineTo(x, toY(v));
    });
    ctx.stroke();
    
    ctx.font = "bold 12px sans-serif";
    ctx.fillStyle = engine.color;
    ctx.beginPath();
    ctx.arc(24, 15, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#334155";
    ctx.fillText("AI Signal", 34, 19);
    
    ctx.fillStyle = "#b83d31";
    ctx.beginPath();
    ctx.arc(104, 15, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#334155";
    ctx.fillText("Baseline", 114, 19);
  }
}

let currentSim = null;
let stepMs = 220;
let isPlaying = true;
let lastTick = 0;
let stepInFlight = false;
let tickStarted = false;

function updateStatus(sim) {
  const chunks = [];
  chunks.push(sim.cfg.fairEval ? "Mode: Fair Shared UE" : "Mode: Demo Multi-UE");
  for (const engine of Object.values(ENGINES)) {
    const agent = sim.agents[engine.key];
    if (!agent.ready) continue;
    const active = agent.current;
    
    let info = "";
    if (typeof agent.lastScore === "number") {
      const decisionText = agent.lastDecisionLabel === 1 ? "Switch" : "Stay";
      info = `${decisionText}, conf ${(agent.lastScore * 100).toFixed(1)}%`;
    } else {
      info = "Pending inference...";
    }
    chunks.push(`${engine.label}: Sat ${active === -1 ? "-" : active + 1}, ${info}`);
  }
  if (chunks.length === 0) {
    statusLine.textContent = "No model ready. Add missing scaler/model paths.";
    return;
  }
  let message = chunks.join(" | ");
  statusLine.textContent = message;
}

function render() {
  if (!currentSim) return;
  drawMap(currentSim, currentSim.t);
  drawSnr(currentSim);
  renderMetrics(currentSim);
  updateStatus(currentSim);
  stepLabel.textContent = `Live step ${currentSim.step} of ${currentSim.cfg.window}`;
}

function maybeCompleteSimulation(sim) {
  if (sim.completed) return;
  if (sim.step >= sim.cfg.window) {
    sim.completed = true;
    isPlaying = false;
    playBtn.textContent = "Play Execution";
    showSummary(sim);
    statusLine.textContent = "Simulation complete. Waiting for rerun.";
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

function resetAllControls() {
  $("satCount").value = defaultControls.satCount;
  $("ueSpeed").value = defaultControls.ueSpeed;
  $("steps").value = defaultControls.steps;
  $("baselineHyst").value = defaultControls.baselineHyst;
  $("speedMs").value = defaultControls.speedMs;
  deterministicToggle.checked = defaultControls.deterministic;
  if (fairEvalToggle) fairEvalToggle.checked = defaultControls.fairEval;
  fixedSeedInput.value = defaultControls.seed;
  fixedSeedInput.disabled = !defaultControls.deterministic;
  updateSliderLabels();
  resetMetricViews();
  run();
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
ueSpeedInput.addEventListener("input", updateSliderLabels);
baselineHystInput.addEventListener("input", updateSliderLabels);
deterministicToggle.addEventListener("change", onDeterministicToggle);
if (fairEvalToggle) fairEvalToggle.addEventListener("change", run);
sidebarToggle.addEventListener("click", onSidebarToggle);
updateSliderLabels();
onDeterministicToggle();
resetMetricViews();
loadModels().then(run);
