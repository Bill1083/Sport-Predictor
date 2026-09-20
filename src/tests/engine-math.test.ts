import { describe, expect, it } from 'vitest';

import { applyTemperature, blend, clipProbs, fitTemperature } from '@/lib/engine/ensemble';
import { lnGamma, normalCdf, normalQuantile, poissonCdf, poissonPmf, poissonQuantile, softmax } from '@/lib/engine/math';
import { brierScore, calibrationBins, logLoss, rankedProbabilityScore, score, summarise } from '@/lib/engine/metrics';
import { gridLines, gridOutcomes, scoreGrid, tau, topScorelines } from '@/lib/engine/poisson';

describe('math', () => {
  it('lnGamma matches factorials', () => {
    expect(Math.exp(lnGamma(5))).toBeCloseTo(24, 6);
    expect(Math.exp(lnGamma(11))).toBeCloseTo(3628800, 0);
  });

  it('poisson pmf sums to one and the cdf/quantile agree', () => {
    let total = 0;
    for (let k = 0; k < 40; k += 1) total += poissonPmf(k, 2.3);
    expect(total).toBeCloseTo(1, 8);
    expect(poissonPmf(0, 1.5)).toBeCloseTo(Math.exp(-1.5), 10);
    expect(poissonCdf(2, 1.5)).toBeCloseTo(0.8088, 3);
    expect(poissonQuantile(0.5, 1.5)).toBe(1);
    expect(poissonQuantile(0.9, 1.5)).toBe(3);
  });

  it('normal cdf and quantile are inverses', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalQuantile(0.975)).toBeCloseTo(1.96, 2);
    expect(normalCdf(normalQuantile(0.3))).toBeCloseTo(0.3, 6);
  });

  it('softmax sums to one and keeps order', () => {
    const p = softmax([1, 2, 3]);
    expect(p.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10);
    expect(p[2]).toBeGreaterThan(p[1]);
  });
});

describe('score grid', () => {
  it('sums to one and shifts toward draws with negative rho', () => {
    const plain = scoreGrid(1.4, 1.1, 0);
    const dc = scoreGrid(1.4, 1.1, -0.13);
    const sum = (g: number[][]) => g.flat().reduce((s, v) => s + v, 0);
    expect(sum(plain)).toBeCloseTo(1, 9);
    expect(sum(dc)).toBeCloseTo(1, 9);
    expect(gridOutcomes(dc).DRAW).toBeGreaterThan(gridOutcomes(plain).DRAW);
    expect(tau(0, 0, 1.4, 1.1, -0.13)).toBeGreaterThan(1);
    expect(tau(1, 1, 1.4, 1.1, -0.13)).toBeGreaterThan(1);
    expect(tau(1, 0, 1.4, 1.1, -0.13)).toBeLessThan(1);
    expect(tau(2, 2, 1.4, 1.1, -0.13)).toBe(1);
  });

  it('favours the side with the higher rate and gives sensible lines', () => {
    const grid = scoreGrid(2.0, 0.8);
    const probs = gridOutcomes(grid);
    expect(probs.HOME).toBeGreaterThan(0.6);
    expect(probs.AWAY).toBeLessThan(0.2);
    const lines = gridLines(grid);
    expect(lines.over25).toBeGreaterThan(0.5);
    expect(lines.btts).toBeGreaterThan(0.3);
    expect(lines.homeCleanSheet).toBeCloseTo(Math.exp(-0.8), 1);
    const top = topScorelines(grid, 3);
    expect(top[0].p).toBeGreaterThanOrEqual(top[1].p);
    // Poisson(2) puts equal mass on 1 and 2, so either 1-0 or 2-0 may lead.
    expect(top[0].away).toBe(0);
    expect([1, 2]).toContain(top[0].home);
  });
});

describe('metrics', () => {
  it('scores a perfect and a uniform forecast as expected', () => {
    expect(brierScore([1, 0, 0], 0)).toBe(0);
    expect(brierScore([1 / 3, 1 / 3, 1 / 3], 0)).toBeCloseTo(2 / 3, 8);
    expect(logLoss([0.5, 0.5], 1)).toBeCloseTo(Math.log(2), 8);
    expect(rankedProbabilityScore([1, 0, 0], 0)).toBe(0);
    expect(rankedProbabilityScore([0, 0, 1], 0)).toBe(1);
    expect(rankedProbabilityScore([1 / 3, 1 / 3, 1 / 3], 1)).toBeCloseTo(1 / 9, 8);
  });

  it('summarises and marks the argmax as correct', () => {
    const s = summarise([score([0.6, 0.25, 0.15], 0), score([0.2, 0.3, 0.5], 2), score([0.5, 0.3, 0.2], 1)]);
    expect(s.n).toBe(3);
    expect(s.accuracy).toBeCloseTo(2 / 3, 8);
    expect(s.rps).not.toBeNull();
  });

  it('bins calibration pairs', () => {
    const bins = calibrationBins([
      { p: 0.05, hit: false },
      { p: 0.15, hit: false },
      { p: 0.95, hit: true },
      { p: 0.92, hit: true },
    ]);
    expect(bins).toHaveLength(10);
    expect(bins[0].n).toBe(1);
    expect(bins[9].n).toBe(2);
    expect(bins[9].observed).toBe(1);
  });
});

describe('ensemble', () => {
  it('blends in log space, honours weights and normalises', () => {
    const p = blend(
      [
        { key: 'a', probs: { HOME: 0.6, DRAW: 0.2, AWAY: 0.2 }, weight: 1 },
        { key: 'b', probs: { HOME: 0.4, DRAW: 0.3, AWAY: 0.3 }, weight: 1 },
      ],
      ['HOME', 'DRAW', 'AWAY'],
    );
    expect(p.HOME + p.DRAW + p.AWAY).toBeCloseTo(1, 10);
    expect(p.HOME).toBeGreaterThan(0.4);
    expect(p.HOME).toBeLessThan(0.6);
    const only = blend([{ key: 'a', probs: { HOME: 0.6, DRAW: 0.2, AWAY: 0.2 }, weight: 1 }, { key: 'b', probs: { HOME: 0.1, DRAW: 0.1, AWAY: 0.8 }, weight: 0 }], ['HOME', 'DRAW', 'AWAY']);
    expect(only.HOME).toBeCloseTo(0.6, 8);
  });

  it('clips extremes and temperature-scales', () => {
    const clipped = clipProbs({ HOME: 0.995, DRAW: 0.004, AWAY: 0.001 });
    expect(clipped.HOME).toBeLessThanOrEqual(0.96);
    expect(clipped.AWAY).toBeGreaterThan(0.01);
    const flat = applyTemperature({ HOME: 0.8, AWAY: 0.2 }, 2);
    expect(flat.HOME).toBeLessThan(0.8);
    const sharp = applyTemperature({ HOME: 0.8, AWAY: 0.2 }, 0.5);
    expect(sharp.HOME).toBeGreaterThan(0.8);
  });

  it('finds a temperature above one for an overconfident forecaster', () => {
    // Truth is 60/40; the forecaster says 85/15 every time.
    const pairs = Array.from({ length: 400 }, (_, i) => ({ probs: [0.85, 0.15], index: i % 5 < 3 ? 0 : 1 }));
    const t = fitTemperature(pairs);
    expect(t).toBeGreaterThan(1.5);
    const adjusted = applyTemperature({ A: 0.85, B: 0.15 }, t);
    expect(adjusted.A).toBeGreaterThan(0.55);
    expect(adjusted.A).toBeLessThan(0.68);
  });
});
