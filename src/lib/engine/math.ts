/**
 * Numeric helpers shared by the models. Pure functions, no dependencies.
 */

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0 (Lanczos approximation, good to ~1e-13). */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < LANCZOS.length; i += 1) a += LANCZOS[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function lnFactorial(k: number): number {
  return lnGamma(k + 1);
}

/** P(X = k) for X ~ Poisson(lambda). */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  return Math.exp(k * Math.log(lambda) - lambda - lnFactorial(k));
}

/** P(X <= k). */
export function poissonCdf(k: number, lambda: number): number {
  let total = 0;
  for (let i = 0; i <= k; i += 1) total += poissonPmf(i, lambda);
  return Math.min(1, total);
}

/** Smallest k with P(X <= k) >= p. */
export function poissonQuantile(p: number, lambda: number): number {
  let k = 0;
  let cumulative = 0;
  while (k < 500) {
    cumulative += poissonPmf(k, lambda);
    if (cumulative >= p) return k;
    k += 1;
  }
  return k;
}

/** Standard normal CDF via the complementary error function. */
export function normalCdf(x: number, mean = 0, sd = 1): number {
  if (sd <= 0) return x < mean ? 0 : 1;
  return 0.5 * erfc(-(x - mean) / (sd * Math.SQRT2));
}

function erfc(x: number): number {
  // Numerical Recipes 6.2, fractional error < 1.2e-7.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Inverse standard normal CDF (Acklam), |error| < 1.15e-9. */
export function normalQuantile(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function logit(p: number): number {
  const q = clamp(p, 1e-9, 1 - 1e-9);
  return Math.log(q / (1 - q));
}

export function softmax(values: number[]): number[] {
  const max = Math.max(...values);
  const exps = values.map((v) => Math.exp(v - max));
  const sum = exps.reduce((s, v) => s + v, 0);
  return exps.map((v) => v / sum);
}

export function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
}

export function weightedMean(values: number[], weights: number[]): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i += 1) {
    num += values[i] * weights[i];
    den += weights[i];
  }
  return den > 0 ? num / den : 0;
}

/** Normalise a probability map so it sums to one; empty maps stay empty. */
export function normaliseProbs<T extends Record<string, number>>(probs: T): T {
  const total = Object.values(probs).reduce((s, v) => s + (Number.isFinite(v) ? Math.max(0, v) : 0), 0);
  if (total <= 0) return probs;
  const out = {} as Record<string, number>;
  for (const [key, value] of Object.entries(probs)) out[key] = Math.max(0, value) / total;
  return out as T;
}

/** Days between two instants, fractional. */
export function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}

/** exp(-xi * days): the time-decay weight used by every fitted model. */
export function decayWeight(daysAgo: number, xi: number): number {
  return Math.exp(-xi * Math.max(0, daysAgo));
}
