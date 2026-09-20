/**
 * Blending model outputs into one forecast, and keeping it honest.
 *
 * A log-linear pool (weighted geometric mean of probabilities) is used
 * rather than an arithmetic one: it rewards agreement, punishes a model that
 * is confidently wrong less brutally than taking it at face value, and is
 * the standard for combining probabilistic forecasts. Weights come from the
 * Lab (or the backtest). Temperature scaling then corrects systematic over-
 * or under-confidence, and a clip keeps any single outcome away from 0 or 1.
 */

import { normaliseProbs } from '@/lib/engine/math';
import type { ProbMap } from '@/lib/types';

export interface Member {
  key: string;
  probs: ProbMap;
  weight: number;
}

export const PROB_FLOOR = 0.02;
export const PROB_CEIL = 0.96;

export function blend(members: Member[], outcomes: string[]): ProbMap {
  const usable = members.filter((m) => m.weight > 0 && outcomes.every((o) => typeof m.probs[o] === 'number' && (m.probs[o] as number) > 0));
  if (usable.length === 0) return normaliseProbs(Object.fromEntries(outcomes.map((o) => [o, 1 / outcomes.length])));
  const totalWeight = usable.reduce((s, m) => s + m.weight, 0);
  const out: ProbMap = {};
  for (const outcome of outcomes) {
    let logP = 0;
    for (const member of usable) logP += (member.weight / totalWeight) * Math.log(member.probs[outcome] as number);
    out[outcome] = Math.exp(logP);
  }
  return normaliseProbs(out);
}

/** Clip each probability into [floor, ceil] and renormalise. */
export function clipProbs(probs: ProbMap, floor = PROB_FLOOR, ceil = PROB_CEIL): ProbMap {
  const out: ProbMap = {};
  for (const [k, v] of Object.entries(probs)) out[k] = Math.min(ceil, Math.max(floor, v));
  return normaliseProbs(out);
}

/** p_i^(1/T) renormalised: T > 1 flattens an overconfident model, T < 1 sharpens. */
export function applyTemperature(probs: ProbMap, temperature: number): ProbMap {
  if (!Number.isFinite(temperature) || temperature <= 0 || Math.abs(temperature - 1) < 1e-6) return probs;
  const out: ProbMap = {};
  for (const [k, v] of Object.entries(probs)) out[k] = Math.max(1e-9, v) ** (1 / temperature);
  return normaliseProbs(out);
}

/**
 * Fit the temperature that minimises log loss over (probs, outcome) pairs.
 * Golden-section search over log T in [-1.5, 1.5] (T in ~[0.22, 4.5]).
 */
export function fitTemperature(pairs: { probs: number[]; index: number }[]): number {
  if (pairs.length < 50) return 1;
  const loss = (t: number): number => {
    let total = 0;
    for (const pair of pairs) {
      const scaled = pair.probs.map((p) => Math.max(1e-9, p) ** (1 / t));
      const sum = scaled.reduce((s, v) => s + v, 0);
      total -= Math.log(Math.max(1e-9, scaled[pair.index] / sum));
    }
    return total / pairs.length;
  };
  let lo = -1.5;
  let hi = 1.5;
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  let fc = loss(Math.exp(c));
  let fd = loss(Math.exp(d));
  for (let i = 0; i < 40; i += 1) {
    if (fc < fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - phi * (hi - lo);
      fc = loss(Math.exp(c));
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + phi * (hi - lo);
      fd = loss(Math.exp(d));
    }
  }
  return Math.exp((lo + hi) / 2);
}

/** Probability map -> ordered array for the metrics functions. */
export function toOrdered(probs: ProbMap, outcomes: string[]): number[] {
  return outcomes.map((o) => probs[o] ?? 0);
}
