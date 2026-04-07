const ort = require('onnxruntime-node');
async function test() {
  const model = await ort.InferenceSession.create('./xgb_model.onnx');
  const scaler = await ort.InferenceSession.create('./xgb_scaler.onnx');
  const features = new Float32Array([100, 0.5, -90, 5, 100, 0.5, 0.5, 0.5, -90]);

  const rawTensor = new ort.Tensor("float32", features, [1, 9]);
  const scaledOut = await scaler.run({ [scaler.inputNames[0]]: rawTensor });
  const scaledTensor = scaledOut[scaler.outputNames[0]];

  const modelOut = await model.run({ [model.inputNames[0]]: scaledTensor });
  console.log("XGB Outputs:", Object.keys(modelOut));
  for (const k of Object.keys(modelOut)) {
    const tensor = modelOut[k];
    console.log(k, tensor.type, tensor.dims, tensor.data);
  }

  const gb_model = await ort.InferenceSession.create('./gb_model.onnx');
  const gb_scaler = await ort.InferenceSession.create('./gb_scaler.onnx');
  const gb_scaledOut = await gb_scaler.run({ [gb_scaler.inputNames[0]]: rawTensor });
  const gb_scaledTensor = gb_scaledOut[gb_scaler.outputNames[0]];
  const gb_modelOut = await gb_model.run({ [gb_model.inputNames[0]]: gb_scaledTensor });
  console.log("GB Outputs:", Object.keys(gb_modelOut));
  for (const k of Object.keys(gb_modelOut)) {
    const tensor = gb_modelOut[k];
    console.log(k, tensor.type, tensor.dims, tensor.data);
  }
}
test();
