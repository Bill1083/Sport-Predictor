import { describe, expect, it } from 'vitest';

import { applyTemperature, fitTemperature, toOrdered } from '@/lib/engine/ensemble';
import { rng } from '@/lib/providers/mock/generator';

/** Mean log loss of a set of two-outcome predictions. */
function meanLogLoss(pairs: { probs: number[]; index: number }[], temperature: number): number {
  let total = 0;
  for (const pair of pairs) {
    const scaled = applyTemperature({ HOME: pair.probs[0], AWAY: pair.probs[1] }, temperature);
    const ordered = toOrdered(scaled, ['HOME', 'AWAY']);
    total -= Math.log(Math.max(1e-9, ordered[pair.index]));
  }
  return total / pairs.length;
}

/**
 * A set of predictions that are right about `accuracy` of the time but state
 * their confidence at `stated`, so the caller can make a model overconfident,
 * underconfident or honest on demand.
 */
function pairs(seed: number, n: number, stated: number, accuracy: number) {
  const random = rng(seed);
  const out: { probs: number[]; index: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const favouriteWins = random() < accuracy;
    out.push({ probs: [stated, 1 - stated], index: favouriteWins ? 0 : 1 });
  }
  return out;
}

describe('fitTemperature', () => {
  it('never returns a temperature that makes the fit worse', () => {
    // The whole point of calibration. If this fails, every prediction the
    // ensemble publishes is being degraded rather than corrected.
    for (const [stated, accuracy] of [
      [0.9, 0.62],
      [0.8, 0.8],
      [0.6, 0.75],
      [0.55, 0.55],
      [0.95, 0.5],
    ]) {
      const set = pairs(11, 4_000, stated, accuracy);
      const fitted = fitTemperature(set);
      expect(meanLogLoss(set, fitted)).toBeLessThanOrEqual(meanLogLoss(set, 1) + 1e-9);
    }
  });

  it('flattens an overconfident model and sharpens an underconfident one', () => {
    const overconfident = pairs(3, 4_000, 0.92, 0.62);
    expect(fitTemperature(overconfident)).toBeGreaterThan(1);
    const underconfident = pairs(3, 4_000, 0.55, 0.85);
    expect(fitTemperature(underconfident)).toBeLessThan(1);
  });

  it('leaves an honest model roughly alone', () => {
    const honest = pairs(5, 6_000, 0.75, 0.75);
    const fitted = fitTemperature(honest);
    expect(fitted).toBeGreaterThan(0.85);
    expect(fitted).toBeLessThan(1.2);
  });

  it('keeps the prior when there is nothing to fit on', () => {
    expect(fitTemperature([])).toBe(1);
    expect(fitTemperature(pairs(1, 10, 0.9, 0.5))).toBe(1);
  });
});
