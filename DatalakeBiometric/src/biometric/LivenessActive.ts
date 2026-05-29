import { FaceDetectionResult } from './FaceDetector';

export type ChallengeType = 'BLINK' | 'SMILE' | 'TURN_HEAD';
export type ChallengeState = 'waiting_action' | 'waiting_reset' | 'passed' | 'failed';
export type ActiveLivenessState = 'waiting' | 'action_detected' | 'passed' | 'timed_out';

export class ActiveLivenessChallenge {
  private type: ChallengeType;
  private state: ChallengeState = 'waiting_action';
  private actionFrames = 0;
  private resetFrames = 0;
  private startTime = Date.now();
  private readonly TIMEOUT_MS = 8000;

  constructor() {
    // Randomize challenge type
    const rand = Math.random();
    if (rand < 0.33) this.type = 'BLINK';
    else if (rand < 0.66) this.type = 'SMILE';
    else this.type = 'TURN_HEAD';
  }

  public getPrompt(): string {
    switch (this.type) {
      case 'BLINK': return 'Please BLINK slowly';
      case 'SMILE': return 'Please SMILE widely';
      case 'TURN_HEAD': return 'Please TURN HEAD left or right';
      default: return 'Follow the prompt';
    }
  }

  public processFace(face: FaceDetectionResult): ActiveLivenessState {
    if (this.state === 'passed') return 'passed';
    if (this.state === 'failed') return 'timed_out';
    
    if (Date.now() - this.startTime > this.TIMEOUT_MS) {
      this.state = 'failed';
      return 'timed_out';
    }
    
    let actionDetected = false;
    let resetDetected = false;

    // We simulate probabilities if they are missing since FaceDetectionResult doesn't enforce smile/yaw
    const faceAny = face as any;
    const leftOpen = face.leftEyeOpenProbability ?? 1.0;
    const rightOpen = face.rightEyeOpenProbability ?? 1.0;
    const smileProb = faceAny.smilingProbability ?? 0.0;
    const yawAngle = faceAny.yawAngle ?? 0.0;
    
    switch (this.type) {
      case 'BLINK':
        actionDetected = (leftOpen < 0.25 && rightOpen < 0.25);
        resetDetected = (leftOpen > 0.65 && rightOpen > 0.65);
        break;
      case 'SMILE':
        actionDetected = (smileProb > 0.7);
        resetDetected = (smileProb < 0.3);
        break;
      case 'TURN_HEAD':
        actionDetected = (Math.abs(yawAngle) > 25);
        resetDetected = (Math.abs(yawAngle) < 10);
        break;
    }

    switch (this.state) {
      case 'waiting_action':
        if (actionDetected) {
          this.actionFrames++;
          if (this.actionFrames >= 2) {
            this.state = 'waiting_reset';
            this.resetFrames = 0;
          }
        } else {
          this.actionFrames = 0;
        }
        break;
        
      case 'waiting_reset':
        if (resetDetected) {
          this.resetFrames++;
          if (this.resetFrames >= 2) {
            this.state = 'passed';
            return 'passed';
          }
        }
        break;
    }
    
    if (this.state === 'waiting_reset') {
      return 'action_detected';
    }
    
    return 'waiting';
  }

  public reset(): void {
    const rand = Math.random();
    if (rand < 0.33) this.type = 'BLINK';
    else if (rand < 0.66) this.type = 'SMILE';
    else this.type = 'TURN_HEAD';

    this.state = 'waiting_action';
    this.actionFrames = 0;
    this.resetFrames = 0;
    this.startTime = Date.now();
  }

  public isComplete(): boolean {
    return this.state === 'passed' || this.state === 'failed';
  }

  public isPassed(): boolean {
    return this.state === 'passed';
  }
}
