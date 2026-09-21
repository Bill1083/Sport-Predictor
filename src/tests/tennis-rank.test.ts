import { describe, expect, it } from 'vitest';

import { eloExpected } from '@/lib/engine/elo';
import { DEFAULT_RANK_PARAMS, fitRankBeta, rankProbs, ratingFromRank, type RankSample } from '@/lib/engine/sports/tennis-rank';
import { setProbFromMatchProb, setScoreForecast, snapToLegalScore } from '@/lib/engine/sports/tennis-sets';
import { matchFromSetProb } from '@/lib/engine/sports/tennis-markov';
import { sportDefinition } from '@/lib/sports/registry';
import { rng } from '@/lib/providers/mock/generator';

describe('rankProbs', () => {
  it('is even between equally ranked players', () => {
    expect(rankProbs(50, 50)?.HOME).toBeCloseTo(0.5, 12);
    expect(rankProbs(1, 1)?.HOME).toBeCloseTo(0.5, 12);
  });

  it('measures the gap in multiples, not places', () => {
    // The whole point of using logs: one against ten is the same edge as
    // thirty against three hundred, and both dwarf 300 against 310.
    const a = rankProbs(1, 10)?.HOME as number;
    const b = rankProbs(30, 300)?.HOME as number;
    expect(a).toBeCloseTo(b, 12);
    const near = rankProbs(300, 310)?.HOME as number;
    expect(near).toBeLessThan(0.52);
    expect(near).toBeGreaterThan(0.5);
  });

  it('matches the worked examples used to design the default', () => {
    expect(rankProbs(1, 100)?.HOME).toBeCloseTo(0.8633, 3);
    expect(rankProbs(96, 166)?.HOME).toBeCloseTo(0.5546, 3);
    expect(rankProbs(107, 779)?.HOME).toBeCloseTo(0.6887, 3);
  });

  it('is antisymmetric', () => {
    for (const [a, b] of [[10, 200], [3, 4], [500, 12]]) {
      expect((rankProbs(a, b)?.HOME as number) + (rankProbs(b, a)?.HOME as number)).toBeCloseTo(1, 12);
    }
  });

  it('stays silent when neither player is ranked', () => {
    expect(rankProbs(null, null)).toBeNull();
  });

  it('only half trusts a one-sided ranking', () => {
    const known = rankProbs(5, 500)?.HOME as number;
    const guessed = rankProbs(5, null)?.HOME as number;
    expect(guessed).toBeGreaterThan(0.5);
    expect(guessed).toBeLessThan(known);
  });

  it('never returns a certainty', () => {
    const extreme = rankProbs(1, 5000)?.HOME as number;
    expect(extreme).toBeLessThanOrEqual(1 - DEFAULT_RANK_PARAMS.floor);
    expect(rankProbs(5000, 1)?.HOME).toBeGreaterThanOrEqual(DEFAULT_RANK_PARAMS.floor);
  });
});

describe('fitRankBeta', () => {
  it('recovers a known beta from synthetic results', () => {
    const random = rng(4242);
    const trueBeta = 0.55;
    const samples: RankSample[] = [];
    for (let i = 0; i < 8000; i += 1) {
      const rankHome = 1 + Math.floor(random() * 300);
      const rankAway = 1 + Math.floor(random() * 300);
      const x = Math.log(rankAway) - Math.log(rankHome);
      const p = 1 / (1 + Math.exp(-trueBeta * x));
      samples.push({ rankHome, rankAway, homeWon: random() < p });
    }
    const fitted = fitRankBeta(samples);
    expect(fitted.beta).toBeGreaterThan(trueBeta - 0.06);
    expect(fitted.beta).toBeLessThan(trueBeta + 0.06);
    expect(fitted.matches).toBe(8000);
    expect(fitted.logLoss).toBeLessThan(0.69);
  });

  it('keeps the prior when there is not enough history', () => {
    const fitted = fitRankBeta([{ rankHome: 1, rankAway: 200, homeWon: true }]);
    expect(fitted.beta).toBe(DEFAULT_RANK_PARAMS.beta);
    expect(fitted.matches).toBe(1);
  });
});

describe('ratingFromRank', () => {
  it('puts the Elo seed on exactly the same scale as the ranking model', () => {
    // If these disagree, a seeded player and the ranking model would argue.
    const options = { beta: DEFAULT_RANK_PARAMS.beta, initialRating: 1500, refRank: 100, seedScale: 1 };
    for (const [a, b] of [[1, 100], [10, 50], [96, 166], [400, 20]]) {
      const viaElo = eloExpected(ratingFromRank(a, options) - ratingFromRank(b, options));
      const viaRank = rankProbs(a, b, { ...DEFAULT_RANK_PARAMS, floor: 0 })?.HOME as number;
      expect(viaElo).toBeCloseTo(viaRank, 8);
    }
  });

  it('places the reference rank at the starting rating', () => {
    const options = { beta: 0.4, initialRating: 1500, refRank: 100, seedScale: 1 };
    expect(ratingFromRank(100, options)).toBeCloseTo(1500, 8);
    expect(ratingFromRank(1, options)).toBeGreaterThan(1750);
    expect(ratingFromRank(500, options)).toBeLessThan(1450);
  });
});

describe('setProbFromMatchProb', () => {
  it('round trips against the forward formula', () => {
    for (const bestOf of [3, 5] as const) {
      for (const s of [0.5, 0.55, 0.6, 0.7, 0.85, 0.95]) {
        const match = matchFromSetProb(s, bestOf).win;
        expect(setProbFromMatchProb(match, bestOf)).toBeCloseTo(s, 8);
      }
    }
  });

  it('turns a coin flip back into a coin flip', () => {
    expect(setProbFromMatchProb(0.5, 3)).toBeCloseTo(0.5, 9);
    expect(setProbFromMatchProb(0.5, 5)).toBeCloseTo(0.5, 9);
  });

  it('agrees with the closed-form inverse for best of three', () => {
    // s = 1/2 - sin(asin(1 - 2P) / 3), used here only as an independent oracle.
    for (const p of [0.05, 0.3, 0.5, 0.72, 0.95]) {
      const closed = 0.5 - Math.sin(Math.asin(1 - 2 * p) / 3);
      expect(setProbFromMatchProb(p, 3)).toBeCloseTo(closed, 8);
    }
  });
});

describe('setScoreForecast', () => {
  it('is symmetric at an even match', () => {
    const f = setScoreForecast(0.5, 3);
    const twoNil = f.top.find((t) => t.home === 2 && t.away === 0)?.p as number;
    const nilTwo = f.top.find((t) => t.home === 0 && t.away === 2)?.p as number;
    expect(twoNil).toBeCloseTo(nilTwo, 8);
    expect(f.top.reduce((t, x) => t + x.p, 0)).toBeCloseTo(1, 6);
  });

  it('never predicts a level set score', () => {
    for (const p of [0.2, 0.5, 0.8]) {
      for (const bestOf of [3, 5] as const) {
        const f = setScoreForecast(p, bestOf);
        expect(f.mostLikely.home).not.toBe(f.mostLikely.away);
        for (const entry of f.top) expect(entry.home).not.toBe(entry.away);
      }
    }
  });

  it('gives a strong favourite a straight-sets win', () => {
    const f = setScoreForecast(0.85, 5);
    expect(f.mostLikely.home).toBe(3);
    expect(f.mostLikely.away).toBeLessThan(2);
  });
});

describe('snapToLegalScore', () => {
  const tennis = sportDefinition('tennis')!;
  const football = sportDefinition('football')!;

  it('rejects a scoreline tennis cannot produce', () => {
    expect(snapToLegalScore({ home: 1, away: 1 }, tennis, 3)).toBeNull();
    expect(snapToLegalScore({ home: 3, away: 0 }, tennis, 3)).toBeNull();
    expect(snapToLegalScore({ home: 2, away: 2 }, tennis, 3)).toBeNull();
    expect(snapToLegalScore({ home: 0, away: 0 }, tennis, 3)).toBeNull();
  });

  it('accepts the legal ones', () => {
    expect(snapToLegalScore({ home: 2, away: 0 }, tennis, 3)).toEqual({ home: 2, away: 0 });
    expect(snapToLegalScore({ home: 1, away: 2 }, tennis, 3)).toEqual({ home: 1, away: 2 });
    expect(snapToLegalScore({ home: 3, away: 2 }, tennis, 5)).toEqual({ home: 3, away: 2 });
  });

  it('leaves other sports alone', () => {
    expect(snapToLegalScore({ home: 1, away: 1 }, football, 3)).toEqual({ home: 1, away: 1 });
    expect(snapToLegalScore({ home: 0, away: 0 }, football, 3)).toEqual({ home: 0, away: 0 });
  });
});
