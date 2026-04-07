# NTN Handover Optimization Simulator

NTN Handover Simulator is a browser-based visualization dashboard and simulation tool that models Non-Terrestrial Network (NTN) satellite handovers for User Equipment (UE). The tool benchmarks classical heuristic threshold-based handover logic against a highly-optimized CatBoost Machine Learning algorithm to minimize handover failures, reduce signal loss, and manage the "ping-pong" effect.

## Features & Capabilities

- **Live Orbital Topography & Movement**: A visual canvas rendering User Equipment (UE) constrained within a defined ground boundary, surrounded by a realistic satellite constellation orbiting within a deep space layer.
- **Real-Time Signal Quality (SNR/RSRP) Tracking**: Dynamic graphs monitor instantaneous Signal-to-Noise Ratio (SNR) of the current serving node vs the best candidate satellite as the UE traverses the map.
- **On-Device Inference**: Uses ONNX Runtime Web to run inference locally in the browser. 
- **CatBoost Optimization**: Implements an optimized decision boundary trained on 200,000 temporal rows of simulated NTN data.

## KPI Improvements (ML vs. Baseline)

Based on the embedded CatBoost algorithm, the NTN Handover Simulator achieves the following performance improvements over traditional rule-based operations:

- **Total Handovers**: Reduced by **52.87%**
- **Ping-Pong Effect**: Reduced by **71.82%** (successive handovers within 10 operation steps)
- **HO Failure Rate**: Reduced by **37.97%**
- **Mean Time Between Handovers (MTBH)**: Increased by **132.30%** (from 74.4 steps to 172.9 steps)

## How to Run the Simulator

Due to browser security policies regarding WebAssembly (WASM) and ONNX model file access, this dashboard needs to be served via a local web server.

1. Open your terminal in the project directory.
2. Start a local HTTP server. For example, using Python:
   ```bash
   python -m http.server 8000
   ```
3. Navigate to `http://localhost:8000` in your web browser.

## Execution Controls

- **UE Velocity**: Manipulate this slider in real-time to adjust the speed of the User Equipment traversing the map. (Adjustments apply instantly without simulator restart)
- **Simulation Length**: Set the total steps executed per simulation run.
- **Playback Interval**: Adjust the execution speed (delay in ms) of the simulation rendering.
- **Reset Orbit Data / Pause Execution**: Recalculate orbits rapidly or freeze logic logic to debug scenarios manually.

## Technologies Used

- **HTML5/Vanilla CSS/JavaScript**: Designed systematically as a high-contrast human-centric engineering dashboard. Solid slate/navy palettes emphasize readability over flashy "AI" graphics.
- **ONNX Runtime Web (`ort.min.js`)**: Executes the pre-trained `.onnx` models entirely on the client, eliminating server-side rendering latency.
- **CatBoost**: Model training performed natively in python, exported through a pipeline to standard ONNX protocols for broad browser compatibility.
