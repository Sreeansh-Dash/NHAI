export interface FaceLandmarks {
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
  nose: { x: number; y: number };
  mouthLeft: { x: number; y: number };
  mouthRight: { x: number; y: number };
}

// ArcFace standard anchor points for 112x112 output
const ANCHORS = [
  [38.2946, 51.6963],   // leftEye
  [73.5318, 51.6963],   // rightEye
  [56.0252, 71.7366],   // nose
  [41.5493, 92.3655],   // mouthLeft
  [70.7299, 92.3655]    // mouthRight
];

export function alignFace(
  framePixels: Uint8Array,
  frameWidth: number,
  frameHeight: number,
  landmarks: FaceLandmarks
): Float32Array {
  const src = [
    [landmarks.leftEye.x, landmarks.leftEye.y],
    [landmarks.rightEye.x, landmarks.rightEye.y],
    [landmarks.nose.x, landmarks.nose.y],
    [landmarks.mouthLeft.x, landmarks.mouthLeft.y],
    [landmarks.mouthRight.x, landmarks.mouthRight.y]
  ];
  
  // 1. Calculate centroids
  let meanSrcX = 0, meanSrcY = 0;
  let meanDstX = 0, meanDstY = 0;
  for (let i = 0; i < 5; i++) {
    meanSrcX += src[i][0];
    meanSrcY += src[i][1];
    meanDstX += ANCHORS[i][0];
    meanDstY += ANCHORS[i][1];
  }
  meanSrcX /= 5;
  meanSrcY /= 5;
  meanDstX /= 5;
  meanDstY /= 5;
  
  // 2. Center coordinates
  const srcC = src.map(pt => [pt[0] - meanSrcX, pt[1] - meanSrcY]);
  const dstC = ANCHORS.map(pt => [pt[0] - meanDstX, pt[1] - meanDstY]);
  
  // 3. Solve normal equations for similarity transform parameter a and b
  // dst_c = [a, -b; b, a] * src_c
  // a = sum(src_c_x * dst_c_x + src_c_y * dst_c_y) / sum(src_c_x^2 + src_c_y^2)
  // b = sum(src_c_x * dst_c_y - src_c_y * dst_c_x) / sum(src_c_x^2 + src_c_y^2)
  let numA = 0;
  let numB = 0;
  let den = 0;
  
  for (let i = 0; i < 5; i++) {
    const sx = srcC[i][0];
    const sy = srcC[i][1];
    const dx = dstC[i][0];
    const dy = dstC[i][1];
    
    numA += (sx * dx + sy * dy);
    numB += (sx * dy - sy * dx);
    den += (sx * sx + sy * sy);
  }
  
  let a = 1.0;
  let b = 0.0;
  if (den > 1e-10) {
    a = numA / den;
    b = numB / den;
  }
  
  const det = a * a + b * b;
  
  // 4. Calculate translation parameters in original coordinates
  const tx = meanDstX - (a * meanSrcX - b * meanSrcY);
  const ty = meanDstY - (b * meanSrcX + a * meanSrcY);
  
  // 5. Build output buffer (112x112x3 Float32Array)
  const output = new Float32Array(112 * 112 * 3);
  
  for (let yOut = 0; yOut < 112; yOut++) {
    for (let xOut = 0; xOut < 112; xOut++) {
      // Map destination coordinates back to source coordinates
      // Solving:
      // a * xSrc - b * ySrc + tx = xOut
      // b * xSrc + a * ySrc + ty = yOut
      // using Cramer's rule
      let xSrc = meanSrcX;
      let ySrc = meanSrcY;
      
      if (det > 1e-10) {
        const u = xOut - tx;
        const v = yOut - ty;
        xSrc = (a * u + b * v) / det;
        ySrc = (-b * u + a * v) / det;
      }
      
      // Bilinear sampling from source image
      const x0 = Math.floor(xSrc);
      const x1 = Math.min(frameWidth - 1, x0 + 1);
      const y0 = Math.floor(ySrc);
      const y1 = Math.min(frameHeight - 1, y0 + 1);
      
      const dx = xSrc - x0;
      const dy = ySrc - y0;
      
      const outIdx = (yOut * 112 + xOut) * 3;
      
      if (x0 >= 0 && x1 < frameWidth && y0 >= 0 && y1 < frameHeight) {
        for (let c = 0; c < 3; c++) {
          const p00 = framePixels[(y0 * frameWidth + x0) * 3 + c];
          const p01 = framePixels[(y0 * frameWidth + x1) * 3 + c];
          const p10 = framePixels[(y1 * frameWidth + x0) * 3 + c];
          const p11 = framePixels[(y1 * frameWidth + x1) * 3 + c];
          
          const val = (1 - dx) * (1 - dy) * p00 +
                      dx * (1 - dy) * p01 +
                      (1 - dx) * dy * p10 +
                      dx * dy * p11;
                      
          // Normalize to [-1.0, 1.0] using: (pixelValue - 127.5) / 128.0
          output[outIdx + c] = (val - 127.5) / 128.0;
        }
      } else {
        // Black pixel for out-of-bounds
        output[outIdx] = -0.996;     // corresponds to (0 - 127.5)/128
        output[outIdx + 1] = -0.996;
        output[outIdx + 2] = -0.996;
      }
    }
  }
  
  return output;
}
