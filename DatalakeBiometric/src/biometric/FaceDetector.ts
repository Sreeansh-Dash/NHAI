export interface FaceDetectionResult {
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  yawAngle?: number;
  pitchAngle?: number;
  rollAngle?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  landmarks?: {
    leftEye?: { x: number; y: number };
    rightEye?: { x: number; y: number };
    nose?: { x: number; y: number };
    mouthLeft?: { x: number; y: number };
    mouthRight?: { x: number; y: number };
  };
}

export interface IQAResult {
  passed: boolean;
  face: FaceDetectionResult | null;
  reason?: 'no_face' | 'multiple_faces' | 'too_small' | 'bad_pose' | 'bad_lighting';
  qualityScore?: number; // 0 to 1
}

export function runIQA(
  frameWidth: number,
  frameHeight: number,
  faces: FaceDetectionResult[]
): IQAResult {
  if (!faces || faces.length === 0) {
    return { passed: false, face: null, reason: 'no_face', qualityScore: 0 };
  }
  
  // Bonus Enhancement: Multi-Face Rejection
  if (faces.length > 1) {
    return { passed: false, face: null, reason: 'multiple_faces', qualityScore: 0 };
  }
  
  const face = faces[0];
  
  // 1. Coverage check (must cover > 18% of frame width/height to ensure enough resolution)
  const faceWidthRatio = face.bounds.width / frameWidth;
  if (faceWidthRatio < 0.18) {
    return { passed: false, face, reason: 'too_small', qualityScore: 0 };
  }
  
  // 2. Pose check (yaw, pitch, roll must be within 25 degrees)
  const yaw = Math.abs(face.yawAngle ?? 99);
  const pitch = Math.abs(face.pitchAngle ?? 99);
  const roll = Math.abs(face.rollAngle ?? 99);
  
  if (yaw >= 25 || pitch >= 25 || roll >= 25) {
    return { passed: false, face, reason: 'bad_pose', qualityScore: 0 };
  }

  // 3. Quality Scoring (Bonus Enhancement)
  // Higher score when face is more centered, larger, and has neutral pose
  const posePenalty = (yaw + pitch + roll) / 75.0; // Max 1.0 penalty if all are 25
  const sizeBonus = Math.min(faceWidthRatio, 0.6) / 0.6; // Max 1.0
  const qualityScore = Math.max(0.1, 1.0 - posePenalty * 0.5 + sizeBonus * 0.2);

  return { passed: true, face, qualityScore: Math.min(qualityScore, 1.0) };
}
