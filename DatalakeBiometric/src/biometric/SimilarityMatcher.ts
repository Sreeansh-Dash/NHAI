export const DEFAULT_THRESHOLD = 0.40; // Calibrated threshold for 192-dim MobileFaceNet

export interface MatchResult {
  matched: boolean;
  userId: string | null;
  score: number;
  threshold: number;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Dimension mismatch: candidate is ${a.length}-dim, template is ${b.length}-dim`);
  }
  
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  
  // Since inputs are assumed L2-normalized (unit vectors), 
  // dot product directly equals the cosine similarity.
  // Clamp value for floating point inaccuracies.
  return Math.max(-1.0, Math.min(1.0, dot));
}

export function matchEmbedding(
  candidate: Float32Array,
  templates: Array<{ userId: string; embedding: Float32Array }>,
  threshold = DEFAULT_THRESHOLD
): MatchResult {
  if (!templates || templates.length === 0) {
    return { matched: false, userId: null, score: 0.0, threshold };
  }
  
  let bestScore = -1.0;
  let bestUserId: string | null = null;
  
  for (const t of templates) {
    try {
      const score = cosineSimilarity(candidate, t.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestUserId = t.userId;
      }
    } catch (e) {
      console.warn("Error matching user template:", e);
    }
  }
  
  const matched = bestScore >= threshold;
  return {
    matched,
    userId: matched ? bestUserId : null,
    score: bestScore,
    threshold
  };
}
