# NTN Handover Optimization Simulator

NTN Handover Simulator is a browser-based visualization dashboard and simulation tool that models Non-Terrestrial Network (NTN) satellite handovers. The tool rigorously benchmarks classical heuristic threshold-based handover logic against three highly-optimized Machine Learning algorithms (CatBoost, XGBoost, and GradientBoost) to minimize handover failures, reduce signal loss, and manage the "ping-pong" effect.

## Features & Capabilities

- **Multiple AI Models**: Continuously evaluates CatBoost, XGBoost, and GradientBoost decision boundaries concurrently.
- **Independent Sovereign Evaluation**: Executes in a multi-agent mode where each AI model is assigned its own independent User Equipment (UE) with unique velocities and starting positions. Each model is rigorously benchmarked against a dedicated "shadow" mathematical baseline mimicking its exact spatial trajectory for absolute fairness.
- **Real-Time Signal Quality Tracking**: Dynamic line graphs locally monitor the instantaneous Signal-to-Noise Ratio (SNR) of the AI's current serving node versus what the heuristic baseline would have achieved on that exact same path.
- **On-Device Inference**: Uses ONNX Runtime Web to run all multi-model inferences locally in the browser, extracting and projecting features seamlessly. 
- **Detailed Post-Simulation Analytics**: Outputs absolute objective performance data (Handovers Executed, final Average SNR in dB) for each AI model against its custom baseline.

## How to Run the Simulator

Due to browser security policies regarding WebAssembly (WASM) and ONNX model file access, this dashboard needs to be served via a local web server.

1. Open your terminal in the project directory.
2. Start a local HTTP server. For example, using Python:
   ```bash
   python -m http.server 8000
   ```
3. Navigate to `http://localhost:8000` in your web browser.

## Execution Controls

- **UE Velocity**: Manipulate this slider in real-time to adjust the base speed of the User Equipment traversing the map.
- **Baseline Hysteresis**: Modify the threshold barrier (in dB) required before the heuristic baseline opts for a handover.
- **Simulation Length**: Set the total steps executed per simulation run.
- **Playback Interval**: Adjust the execution speed (delay in ms) of the visual renderer.
- **Deterministic Playback**: Toggle the ability to lock random seeds to generate absolutely reproducible orbits and trajectory paths.

## Technologies Used

- **HTML5/Vanilla CSS/JavaScript**: Designed systematically as a high-contrast human-centric engineering dashboard. Solid slate/navy palettes emphasize readability over flashy components.
- **ONNX Runtime Web (`ort.min.js`)**: Executes the pre-trained `.onnx` models entirely on the client without invoking network payload bottlenecks.
- **CatBoost / XGBoost / GradientBoost**: Decision trees engineered in Python, structured, scaled, and compiled down to standard ONNX endpoints for seamless Javascript consumption.
