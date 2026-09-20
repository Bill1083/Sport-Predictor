/**
 * Multinomial logistic regression (softmax) over a feature vector, with L2
 * regularisation and standardised inputs. Small, dependency-free and fast
 * enough for a few thousand rows, which is what one sport's history is.
 * It is the "feature model" layer: it learns how much rating gap, form,
 * rest, absences and the rest actually matter for this sport.
 */

import { softmax } from '@/lib/engine/math';

export interface LogisticRow {
  features: Record<string, number>;
  outcome: string;
  weight?: number;
}

export interface LogisticParams {
  l2: number;
  iterations: number;
  learningRate: number;
}

export const DEFAULT_LOGISTIC_PARAMS: LogisticParams = { l2: 0.5, iterations: 600, learningRate: 0.15 };

export interface LogisticState {
  classes: string[];
  featureKeys: string[];
  mean: number[];
  sd: number[];
  /** weights[class][feature + 1], the last entry is the bias. */
  weights: number[][];
  rows: number;
  fittedAt: string;
}

function standardise(features: Record<string, number>, state: Pick<LogisticState, 'featureKeys' | 'mean' | 'sd'>): number[] {
  return state.featureKeys.map((key, i) => {
    const v = features[key];
    const x = typeof v === 'number' && Number.isFinite(v) ? v : state.mean[i];
    return state.sd[i] > 0 ? (x - state.mean[i]) / state.sd[i] : 0;
  });
}

function logits(x: number[], weights: number[][]): number[] {
  return weights.map((w) => {
    let z = w[w.length - 1];
    for (let i = 0; i < x.length; i += 1) z += w[i] * x[i];
    return z;
  });
}

export function fitLogistic(rows: LogisticRow[], classes: string[], featureKeys: string[], params: LogisticParams = DEFAULT_LOGISTIC_PARAMS): LogisticState {
  const n = rows.length;
  const mean = featureKeys.map((key) => rows.reduce((s, r) => s + (r.features[key] ?? 0), 0) / Math.max(1, n));
  const sd = featureKeys.map((key, i) => Math.sqrt(rows.reduce((s, r) => s + ((r.features[key] ?? 0) - mean[i]) ** 2, 0) / Math.max(1, n)));
  const state: LogisticState = {
    classes,
    featureKeys,
    mean,
    sd,
    weights: classes.map(() => new Array<number>(featureKeys.length + 1).fill(0)),
    rows: n,
    fittedAt: new Date().toISOString(),
  };
  if (n === 0) return state;

  const xs = rows.map((r) => standardise(r.features, state));
  const ys = rows.map((r) => classes.indexOf(r.outcome));
  const ws = rows.map((r) => r.weight ?? 1);
  const totalW = ws.reduce((s, w) => s + w, 0);
  const k = classes.length;
  const f = featureKeys.length;

  for (let iter = 0; iter < params.iterations; iter += 1) {
    const grad = state.weights.map((w) => new Array<number>(w.length).fill(0));
    for (let r = 0; r < n; r += 1) {
      if (ys[r] < 0) continue;
      const p = softmax(logits(xs[r], state.weights));
      for (let c = 0; c < k; c += 1) {
        const err = (p[c] - (c === ys[r] ? 1 : 0)) * ws[r];
        for (let i = 0; i < f; i += 1) grad[c][i] += err * xs[r][i];
        grad[c][f] += err;
      }
    }
    const lr = params.learningRate / Math.max(1, totalW);
    for (let c = 0; c < k; c += 1) {
      for (let i = 0; i < f; i += 1) {
        state.weights[c][i] -= lr * (grad[c][i] + params.l2 * state.weights[c][i]);
      }
      state.weights[c][f] -= lr * grad[c][f];
    }
  }
  return state;
}

export function predictLogistic(state: LogisticState, features: Record<string, number>): Record<string, number> {
  if (state.rows === 0) return {};
  const p = softmax(logits(standardise(features, state), state.weights));
  return Object.fromEntries(state.classes.map((c, i) => [c, p[i]]));
}

/**
 * Contribution of each feature to the home-side log-odds versus the away
 * side, in standardised units times the weight. Used to explain a prediction.
 */
export function logisticContributions(state: LogisticState, features: Record<string, number>): Record<string, number> {
  const home = state.classes.indexOf('HOME');
  const away = state.classes.indexOf('AWAY');
  if (home < 0 || away < 0 || state.rows === 0) return {};
  const x = standardise(features, state);
  const out: Record<string, number> = {};
  state.featureKeys.forEach((key, i) => {
    out[key] = (state.weights[home][i] - state.weights[away][i]) * x[i];
  });
  return out;
}
