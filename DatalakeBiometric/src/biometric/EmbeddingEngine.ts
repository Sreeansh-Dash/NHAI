import { loadTensorflowModel, TensorflowModel } from 'react-native-fast-tflite';

let embeddingModel: TensorflowModel | null = null;

export async function initEmbeddingEngine(): Promise<void> {
  if (embeddingModel) return;
  try {
    const modelAsset = require('../assets/models/mobilefacenet.tflite');
    embeddingModel = await loadTensorflowModel(modelAsset);
    console.log("MobileFaceNet embedding engine loaded successfully.");
  } catch (error) {
    console.error("Failed to load MobileFaceNet model:", error);
    throw error;
  }
}

export async function generateEmbedding(
  alignedFaceFloat32: Float32Array
): Promise<Float32Array> {
  if (!embeddingModel) {
    throw new Error("Embedding engine not initialized");
  }
  
  // Inference
  // Expects input shape: [1, 112, 112, 3]
  const outputs = await embeddingModel.run([alignedFaceFloat32]);
  const rawEmbedding = outputs[0] as Float32Array; // 192-dimensional vector
  
  // Apply L2 normalization to project embedding on unit hypersphere
  let sumSq = 0;
  for (let i = 0; i < rawEmbedding.length; i++) {
    sumSq += rawEmbedding[i] * rawEmbedding[i];
  }
  const magnitude = Math.sqrt(sumSq);
  
  if (magnitude < 1e-10) {
    throw new Error("Invalid zero embedding generated — face feature extraction failed");
  }
  
  const normalized = new Float32Array(rawEmbedding.length);
  for (let i = 0; i < rawEmbedding.length; i++) {
    normalized[i] = rawEmbedding[i] / magnitude;
  }
  
  return normalized;
}
