import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';

let passiveLivenessModel: TensorflowModel | null = null;

export async function initPassiveLiveness(): Promise<void> {
  if (passiveLivenessModel) return;
  try {
    // Metro bundler resolves .tflite as asset number
    const modelAsset = require('../assets/models/minifasnet_v2_se.tflite');
    passiveLivenessModel = await loadTensorflowModel(modelAsset, 'default');
    console.log("MiniFASNet passive liveness model loaded successfully.");
  } catch (error) {
    console.error("Failed to load MiniFASNet model:", error);
    throw error;
  }
}

export async function checkPassiveLiveness(
  framePixels: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  faceBounds: { x: number; y: number; width: number; height: number }
): Promise<{ isReal: boolean; realScore: number }> {
  if (!passiveLivenessModel) {
    throw new Error("Passive liveness model not initialized");
  }

  // 1. Expand bounds by 4/3 ratio
  const targetW = faceBounds.width * 1.333;
  const targetH = faceBounds.height * 1.333;
  const expandW = (targetW - faceBounds.width) / 2;
  const expandH = (targetH - faceBounds.height) / 2;
  
  const cropX = Math.max(0, Math.floor(faceBounds.x - expandW));
  const cropY = Math.max(0, Math.floor(faceBounds.y - expandH));
  const cropW = Math.min(frameWidth - cropX, Math.floor(faceBounds.width + 2 * expandW));
  const cropH = Math.min(frameHeight - cropY, Math.floor(faceBounds.height + 2 * expandH));

  // 2. Crop and resize to 80x80
  const resizedPixels = cropAndResizeRGB(
    framePixels,
    frameWidth,
    frameHeight,
    cropX,
    cropY,
    cropW,
    cropH,
    80,
    80
  );

  // 3. Normalize to ImageNet stats: mean=[0.406, 0.456, 0.485], std=[0.225, 0.224, 0.229]
  const inputTensor = new Float32Array(80 * 80 * 3);
  const mean = [0.406, 0.456, 0.485];
  const std = [0.225, 0.224, 0.229];
  
  for (let p = 0; p < 80 * 80; p++) {
    for (let c = 0; c < 3; c++) {
      const pixelVal = resizedPixels[p * 3 + c] / 255.0;
      inputTensor[p * 3 + c] = (pixelVal - mean[c]) / std[c];
    }
  }

  // 4. Run model
  // Note: react-native-fast-tflite run takes array of typed arrays
  const output = await passiveLivenessModel.run([inputTensor]);
  
  // Output shape is [1, 2] -> logits for [spoof, real]
  const logits = output[0] as Float32Array;
  const spoofLogit = logits[0];
  const realLogit = logits[1];

  // Softmax
  const expSpoof = Math.exp(spoofLogit);
  const expReal = Math.exp(realLogit);
  const realScore = expReal / (expSpoof + expReal);

  console.log(`Passive liveness check: realScore=${realScore.toFixed(4)}`);

  return {
    isReal: realScore > 0.60,
    realScore
  };
}

// Inline helper for pure TS bilinear cropping & resizing
function cropAndResizeRGB(
  pixels: Uint8Array,
  width: number,
  height: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
  targetW: number,
  targetH: number
): Uint8Array {
  const output = new Uint8Array(targetW * targetH * 3);
  
  for (let dy = 0; dy < targetH; dy++) {
    for (let dx = 0; dx < targetW; dx++) {
      const cx = (dx / targetW) * cropW;
      const cy = (dy / targetH) * cropH;
      
      const sx = cropX + cx;
      const sy = cropY + cy;
      
      const x0 = Math.floor(sx);
      const x1 = Math.min(width - 1, x0 + 1);
      const y0 = Math.floor(sy);
      const y1 = Math.min(height - 1, y0 + 1);
      
      const tx = sx - x0;
      const ty = sy - y0;
      
      for (let c = 0; c < 3; c++) {
        const p00 = pixels[(y0 * width + x0) * 3 + c];
        const p01 = pixels[(y0 * width + x1) * 3 + c];
        const p10 = pixels[(y1 * width + x0) * 3 + c];
        const p11 = pixels[(y1 * width + x1) * 3 + c];
        
        const val = (1 - tx) * (1 - ty) * p00 +
                    tx * (1 - ty) * p01 +
                    (1 - tx) * ty * p10 +
                    tx * ty * p11;
                    
        output[(dy * targetW + dx) * 3 + c] = Math.round(val);
      }
    }
  }
  return output;
}
