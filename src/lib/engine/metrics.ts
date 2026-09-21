/**
 * Proper scoring rules and calibration summaries. `probs` is in the sport's
 * outcome order (HOME, DRAW, AWAY or HOME, AWAY); `index` is the outcome
 * that happened.
 */

export interface Scores {
  brier: number;
  logLoss: number;
  /** Ranked probability score; only meaningful for three ordered outcomes. */
  rps: number | null;
  correct: boolean;
  /** The highest probability was shared, so there was no favourite to be right about. */
  tied: boolean;
}

const EPS = 1e-6;

export function brierScore(probs: number[], index: number): number {
  let total = 0;
  for (let i = 0; i < probs.length; i += 1) total += (probs[i] - (i === index ? 1 : 0)) ** 2;
  return total;
}

export function logLoss(probs: number[], index: number): number {
  return -Math.log(Math.max(EPS, probs[index] ?? 0));
}

/** RPS for ordered outcomes: cumulative squared error, normalised by K-1. */
export function rankedProbabilityScore(probs: number[], index: number): number {
  const k = probs.length;
  if (k < 2) return 0;
  let cumP = 0;
  let cumY = 0;
  let total = 0;
  for (let i = 0; i < k - 1; i += 1) {
    cumP += probs[i];
    cumY += i === index ? 1 : 0;
    total += (cumP - cumY) ** 2;
  }
  return total / (k - 1);
}

const TIE_EPS = 1e-9;

/**
 * Reading the favourite off the highest probability quietly credits index zero
 * whenever two outcomes are level, which for a player sport means the
 * alphabetically earlier name wins every coin flip. A shared maximum is
 * recorded as no call at all, and accuracy is taken over the calls that were
 * actually made.
 */
export function score(probs: number[], index: number): Scores {
  // A caller that cannot map the result to one of the sport's outcomes must
  // skip the row, not pass -1: that would charge a maximum-loss miss.
  if (index < 0 || index >= probs.length) throw new Error(`score: outcome index ${index} is outside the ${probs.length} outcomes`);
  const max = Math.max(...probs);
  let leaders = 0;
  let best = -1;
  for (let i = 0; i < probs.length; i += 1) {
    if (probs[i] >= max - TIE_EPS) {
      leaders += 1;
      if (best < 0) best = i;
    }
  }
  const tied = leaders > 1;
  return {
    brier: brierScore(probs, index),
    logLoss: logLoss(probs, index),
    rps: probs.length === 3 ? rankedProbabilityScore(probs, index) : null,
    correct: !tied && best === index,
    tied,
  };
}

export interface Summary {
  n: number;
  brier: number;
  logLoss: number;
  rps: number | null;
  accuracy: number;
  /** Predictions with no favourite, excluded from accuracy. */
  ties: number;
}

export function summarise(scores: Scores[]): Summary {
  if (scores.length === 0) return { n: 0, brier: 0, logLoss: 0, rps: null, accuracy: 0, ties: 0 };
  const n = scores.length;
  const withRps = scores.filter((s) => s.rps !== null);
  const decided = scores.filter((s) => !s.tied);
  return {
    n,
    brier: scores.reduce((s, x) => s + x.brier, 0) / n,
    logLoss: scores.reduce((s, x) => s + x.logLoss, 0) / n,
    rps: withRps.length > 0 ? withRps.reduce((s, x) => s + (x.rps as number), 0) / withRps.length : null,
    accuracy: decided.length > 0 ? decided.filter((s) => s.correct).length / decided.length : 0,
    ties: n - decided.length,
  };
}

export interface CalibrationBin {
  low: number;
  high: number;
  n: number;
  /** Mean forecast probability in the bin. */
  forecast: number;
  /** Observed frequency in the bin. */
  observed: number;
}

/**
 * Reliability table over every (probability, happened) pair, e.g. one pair
 * per outcome per prediction. A well-calibrated model has observed close to
 * forecast in every bin.
 */
export function calibrationBins(pairs: { p: number; hit: boolean }[], bins = 10): CalibrationBin[] {
  const out: CalibrationBin[] = Array.from({ length: bins }, (_, i) => ({ low: i / bins, high: (i + 1) / bins, n: 0, forecast: 0, observed: 0 }));
  for (const pair of pairs) {
    const i = Math.min(bins - 1, Math.max(0, Math.floor(pair.p * bins)));
    out[i].n += 1;
    out[i].forecast += pair.p;
    out[i].observed += pair.hit ? 1 : 0;
  }
  for (const bin of out) {
    if (bin.n > 0) {
      bin.forecast /= bin.n;
      bin.observed /= bin.n;
    }
  }
  return out;
}

/** Slope of observed on forecast across the populated bins; 1 is perfect. */
export function calibrationSlope(bins: CalibrationBin[]): number | null {
  const used = bins.filter((b) => b.n >= 5);
  if (used.length < 3) return null;
  const totalN = used.reduce((s, b) => s + b.n, 0);
  const mx = used.reduce((s, b) => s + b.forecast * b.n, 0) / totalN;
  const my = used.reduce((s, b) => s + b.observed * b.n, 0) / totalN;
  let num = 0;
  let den = 0;
  for (const b of used) {
    num += b.n * (b.forecast - mx) * (b.observed - my);
    den += b.n * (b.forecast - mx) ** 2;
  }
  return den > 0 ? num / den : null;
}
