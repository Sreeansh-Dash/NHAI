import { runIQA, FaceDetectionResult, IQAResult } from './FaceDetector';
import { ActiveLivenessChallenge, ActiveLivenessState } from './LivenessActive';
import { initPassiveLiveness, checkPassiveLiveness } from './LivenessPassive';
import { alignFace } from './FaceAligner';
import { initEmbeddingEngine, generateEmbedding } from './EmbeddingEngine';
import { matchEmbedding, MatchResult } from './SimilarityMatcher';
import * as SecureDatabase from '../storage/SecureDatabase';
import { getCurrentLocation } from '../utils/LocationUtils';

export type PipelineStage = 'INIT' | 'IQA' | 'ACTIVE_LIVENESS' | 'PASSIVE' | 'ALIGNING' | 'MATCHING' | 'DONE';

export interface VerifyResult {
  success: boolean;
  userId: string | null;
  score: number;
  failReason?: 'no_face' | 'bad_quality' | 'liveness_timeout' | 'spoof_detected' | 'no_match';
  processingTimeMs: number;
}

export class BiometricPipeline {
  private activeChallenge = new ActiveLivenessChallenge();
  private passiveDone = false;
  private isInitialized = false;

  public async initialize(): Promise<void> {
    if (this.isInitialized) return;
    await Promise.all([
      initPassiveLiveness(),
      initEmbeddingEngine()
    ]);
    this.isInitialized = true;
    console.log("BiometricPipeline initialized successfully.");
  }

  public reset(): void {
    this.activeChallenge.reset();
    this.passiveDone = false;
  }

  // Phase 4.2: Warmup models to prevent cold-start latency on first check-in
  public async warmup(): Promise<void> {
    if (!this.isInitialized) return;
    try {
      // Dummy face and frames
      const dummyFace = new Float32Array(112 * 112 * 3);
      const dummyPassive = new Uint8Array(80 * 80 * 3);
      
      console.log("Warming up models...");
      await Promise.all([
        generateEmbedding(dummyFace),
        checkPassiveLiveness(dummyPassive, 80, 80, { x: 0, y: 0, width: 80, height: 80 })
      ]);
      console.log("Models warmed up successfully.");
    } catch (e) {
      console.warn("Warmup error (safe to ignore):", e);
    }
  }

  // Processes a frame in real-time. Returns null if still in progress, or VerifyResult when complete.
  public async processFrame(
    framePixels: Uint8Array,
    width: number,
    height: number,
    faces: FaceDetectionResult[],
    onStageChange: (stage: PipelineStage, hint: string) => void
  ): Promise<VerifyResult | null> {
    if (!this.isInitialized) {
      onStageChange('INIT', 'Initializing biometric engines...');
      return null;
    }

    const startTime = Date.now();

    // 1. Run Image Quality Assessment (IQA)
    onStageChange('IQA', 'Checking image quality...');
    const iqaResult = runIQA(width, height, faces);
    if (!iqaResult.passed) {
      let hint = 'Center your face in the camera';
      if (iqaResult.reason === 'multiple_faces') hint = 'Ensure only one face is visible';
      if (iqaResult.reason === 'too_small') hint = 'Move closer to the camera';
      if (iqaResult.reason === 'bad_pose') hint = 'Look straight at the camera';
      
      onStageChange('IQA', hint);
      return null; // Keep waiting for a quality frame
    }

    const face = iqaResult.face!;
    const qualityScore = iqaResult.qualityScore || 0.5; // From Bonus Enhancement

    // 2. Active Liveness: Randomized Challenge
    const prompt = this.activeChallenge.getPrompt();
    onStageChange('ACTIVE_LIVENESS', prompt);
    const activeState = this.activeChallenge.processFace(face);
    
    if (activeState === 'timed_out') {
      this.reset();
      return {
        success: false,
        userId: null,
        score: 0,
        failReason: 'liveness_timeout',
        processingTimeMs: Date.now() - startTime
      };
    }
    
    if (activeState === 'waiting') {
      return null; // Keep waiting for active challenge to complete
    }
    
    if (activeState === 'action_detected') {
      onStageChange('ACTIVE_LIVENESS', 'Action detected! Keep still...');
      return null;
    }

    // 3. Passive Liveness: MiniFASNet SE classification
    onStageChange('PASSIVE', 'Checking security...');
    const livenessResult = await checkPassiveLiveness(framePixels, width, height, face.bounds);
    if (!livenessResult.isReal) {
      // LOG SPOOF ATTEMPT TO SECURITY DATABASE
      await SecureDatabase.logSecurityEvent(
        'SPOOF_ATTEMPT',
        `Spoof attempt detected. Score: ${livenessResult.realScore.toFixed(4)}. Bounding Box: ${JSON.stringify(face.bounds)}`
      );
      this.reset();
      return {
        success: false,
        userId: null,
        score: livenessResult.realScore,
        failReason: 'spoof_detected',
        processingTimeMs: Date.now() - startTime
      };
    }

    // 4. Face Alignment: Umeyama similarity transform
    onStageChange('ALIGNING', 'Aligning face features...');
    if (!face.landmarks || !face.landmarks.leftEye || !face.landmarks.rightEye || 
        !face.landmarks.nose || !face.landmarks.mouthLeft || !face.landmarks.mouthRight) {
      onStageChange('IQA', 'Landmarks missing. Stay still...');
      return null;
    }

    const alignedFace = alignFace(framePixels, width, height, {
      leftEye: face.landmarks.leftEye,
      rightEye: face.landmarks.rightEye,
      nose: face.landmarks.nose,
      mouthLeft: face.landmarks.mouthLeft,
      mouthRight: face.landmarks.mouthRight
    });

    // 5. Embedding Generation: MobileFaceNet inference
    onStageChange('MATCHING', 'Verifying attendance...');
    let embedding: Float32Array;
    try {
      embedding = await generateEmbedding(alignedFace);
      // Clean up aligned face buffer to assist GC
      (alignedFace as any) = null;
    } catch (e) {
      console.error("Embedding generation failed:", e);
      return {
        success: false,
        userId: null,
        score: 0,
        failReason: 'bad_quality',
        processingTimeMs: Date.now() - startTime
      };
    }

    // 6. Similarity Matching: Cosine similarity
    // Bonus Enhancement: Adaptive Threshold Logic
    // If quality is high (score > 0.8), threshold is 0.40. 
    // If quality is poor (e.g. 0.4), threshold tightens (increases) to 0.45 to prevent false accepts under bad conditions.
    const adaptiveThreshold = 0.40 + Math.max(0, (0.8 - qualityScore) * 0.1);
    
    const templates = await SecureDatabase.getAllTemplates();
    const matchResult = matchEmbedding(embedding, templates, adaptiveThreshold);

    this.reset(); // Reset pipeline for next attempt

    if (matchResult.matched) {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const loc = await getCurrentLocation();
        lat = loc.latitude;
        lng = loc.longitude;
      } catch (e) {
        console.warn("Could not capture GPS location:", e);
      }
      
      // Write attendance transactionally to DB
      await SecureDatabase.recordAttendance({
        userId: matchResult.userId!,
        score: matchResult.score,
        lat,
        lng
      });
      
      // Memory cleanup
      (embedding as any) = null;
      
      return {
        success: true,
        userId: matchResult.userId,
        score: matchResult.score,
        processingTimeMs: Date.now() - startTime
      };
    } else {
      // Memory cleanup
      (embedding as any) = null;
      
      return {
        success: false,
        userId: null,
        score: matchResult.score,
        failReason: 'no_match',
        processingTimeMs: Date.now() - startTime
      };
    }
  }

  // Enrolls a user using 5 IQA-passed frames and their corresponding face detections
  public async enrollUser(
    userId: string,
    framesPixels: Uint8Array[],
    facesList: FaceDetectionResult[],
    width: number,
    height: number
  ): Promise<boolean> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (framesPixels.length < 5 || facesList.length < 5) {
      console.error("Cannot enroll user: need at least 5 quality frames");
      return false;
    }

    try {
      const embeddings: Float32Array[] = [];

      for (let i = 0; i < 5; i++) {
        const frame = framesPixels[i];
        const face = facesList[i];

        if (!face.landmarks || !face.landmarks.leftEye || !face.landmarks.rightEye || 
            !face.landmarks.nose || !face.landmarks.mouthLeft || !face.landmarks.mouthRight) {
          throw new Error("Missing landmarks in frame " + i);
        }

        // Bonus Enhancement: Enrollment Quality Scorer
        // Ensure that we only enroll very high-quality frames
        const iqa = runIQA(width, height, [face]);
        if (!iqa.passed || (iqa.qualityScore && iqa.qualityScore < 0.7)) {
           throw new Error("Enrollment frame quality too low for secure template generation");
        }

        // Align
        const aligned = alignFace(frame, width, height, {
          leftEye: face.landmarks.leftEye,
          rightEye: face.landmarks.rightEye,
          nose: face.landmarks.nose,
          mouthLeft: face.landmarks.mouthLeft,
          mouthRight: face.landmarks.mouthRight
        });

        // Generate embedding
        const emb = await generateEmbedding(aligned);
        embeddings.push(emb);
        // Clean up memory
        (aligned as any) = null;
      }

      // Average the 5 embeddings element-wise
      const dim = embeddings[0].length;
      const averaged = new Float32Array(dim);
      for (let j = 0; j < dim; j++) {
        averaged[j] = (embeddings[0][j] + embeddings[1][j] + embeddings[2][j] + embeddings[3][j] + embeddings[4][j]) / 5.0;
      }

      // Re-normalize the averaged embedding to ensure it lies on the unit hypersphere
      let sumSq = 0;
      for (let j = 0; j < dim; j++) {
        sumSq += averaged[j] * averaged[j];
      }
      const magnitude = Math.sqrt(sumSq);
      if (magnitude > 1e-10) {
        for (let j = 0; j < dim; j++) {
          averaged[j] /= magnitude;
        }
      }

      // Save to database
      await SecureDatabase.enrollFace(userId, averaged);
      return true;
    } catch (e) {
      console.error("Enrollment failed:", e);
      return false;
    }
  }
}
