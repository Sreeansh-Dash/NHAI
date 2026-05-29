import { FaceDetectionResult } from './FaceDetector';

export type BlinkChallengeState = 'waiting_open' | 'waiting_close' | 'waiting_reopen' | 'passed' | 'failed';
export type BlinkState = 'waiting' | 'blink_detected' | 'passed' | 'timed_out';

export class BlinkChallenge {
  private state: BlinkChallengeState = 'waiting_open';
  private openFrames = 0;
  private closedFrames = 0;
  private reopenFrames = 0;
  private startTime = Date.now();
  private readonly TIMEOUT_MS = 8000; // 8 seconds timeout

  public processFace(face: FaceDetectionResult): BlinkState {
    if (this.state === 'passed') return 'passed';
    if (this.state === 'failed') return 'timed_out';
    
    // Check timeout
    if (Date.now() - this.startTime > this.TIMEOUT_MS) {
      this.state = 'failed';
      return 'timed_out';
    }
    
    const leftOpen = face.leftEyeOpenProbability;
    const rightOpen = face.rightEyeOpenProbability;
    
    // Guard against null probability values (e.g. tracking lost or low light)
    if (leftOpen == null || rightOpen == null) {
      return 'waiting';
    }
    
    switch (this.state) {
      case 'waiting_open':
        // Wait for both eyes open (prob > 0.75) for 3 consecutive frames
        if (leftOpen > 0.75 && rightOpen > 0.75) {
          this.openFrames++;
          if (this.openFrames >= 3) {
            this.state = 'waiting_close';
            this.closedFrames = 0;
          }
        } else {
          this.openFrames = 0;
        }
        break;
        
      case 'waiting_close':
        // Wait for both eyes closed (prob < 0.25) for 2 consecutive frames
        if (leftOpen < 0.25 && rightOpen < 0.25) {
          this.closedFrames++;
          if (this.closedFrames >= 2) {
            this.state = 'waiting_reopen';
            this.reopenFrames = 0;
          }
        } else {
          // Keep waiting for eye closure. Do not reset immediately since blink is fast.
        }
        break;
        
      case 'waiting_reopen':
        // Wait for eyes to reopen (prob > 0.65) for 2 consecutive frames
        if (leftOpen > 0.65 && rightOpen > 0.65) {
          this.reopenFrames++;
          if (this.reopenFrames >= 2) {
            this.state = 'passed';
            return 'passed';
          }
        } else {
          // Keep waiting for reopen
        }
        break;
        
      default:
        break;
    }
    
    // If we've successfully closed eyes, report blink in progress
    if (this.state === 'waiting_reopen') {
      return 'blink_detected';
    }
    
    return 'waiting';
  }

  public reset(): void {
    this.state = 'waiting_open';
    this.openFrames = 0;
    this.closedFrames = 0;
    this.reopenFrames = 0;
    this.startTime = Date.now();
  }

  public isComplete(): boolean {
    return this.state === 'passed' || this.state === 'failed';
  }

  public isPassed(): boolean {
    return this.state === 'passed';
  }
  
  public getChallengeState(): BlinkChallengeState {
    return this.state;
  }
}
