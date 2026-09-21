import { describe, expect, it } from 'vitest';

import {
  deuceWin,
  gameWin,
  markovForecast,
  matchFromSetProb,
  parseTennisFormat,
  setWin,
  setWinAveraged,
  tiebreakWin,
} from '@/lib/engine/sports/tennis-markov';
import { rng } from '@/lib/providers/mock/generator';

describe('gameWin', () => {
  it('reproduces the published hold rates', () => {
    // A player winning 60% of serve points holds about 73.6% of the time; this
    // is the standard worked example and pins the whole deuce recursion.
    expect(gameWin(0.5)).toBeCloseTo(0.5, 12);
    expect(gameWin(0.6)).toBeCloseTo(0.735_729, 6);
    expect(gameWin(0.7)).toBeCloseTo(0.900_789, 6);
    expect(gameWin(0.65)).toBeCloseTo(0.829_645, 6);
  });

  it('is monotonic and handles the extremes', () => {
    expect(gameWin(0)).toBe(0);
    expect(gameWin(1)).toBe(1);
    let previous = 0;
    for (let p = 0.01; p < 0.99; p += 0.01) {
      const value = gameWin(p);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it('computes the deuce cycle', () => {
    expect(deuceWin(0.6)).toBeCloseTo(0.36 / 0.52, 12);
    expect(deuceWin(0.5)).toBeCloseTo(0.5, 12);
  });
});

describe('tiebreakWin', () => {
  it('is exactly even for two identical servers, whatever the serve rate', () => {
    // A pure symmetry invariant: it fails if the serve rotation is wrong.
    for (const p of [0.5, 0.55, 0.6, 0.7, 0.8]) {
      expect(tiebreakWin(p, p, true)).toBeCloseTo(0.5, 10);
      expect(tiebreakWin(p, p, false)).toBeCloseTo(0.5, 10);
    }
  });

  it('is complementary when the players swap', () => {
    expect(tiebreakWin(0.65, 0.6, true) + tiebreakWin(0.6, 0.65, true)).toBeCloseTo(1, 10);
  });

  it('favours the better server', () => {
    expect(tiebreakWin(0.7, 0.6, true)).toBeGreaterThan(0.5);
    expect(tiebreakWin(0.6, 0.7, true)).toBeLessThan(0.5);
  });
});

describe('setWin', () => {
  it('is even between identical players', () => {
    for (const p of [0.5, 0.6, 0.7]) {
      expect(setWinAveraged(p, p)).toBeCloseTo(0.5, 8);
    }
  });

  it('gives the better server the set more often', () => {
    expect(setWinAveraged(0.65, 0.6)).toBeGreaterThan(0.5);
    expect(setWin(0.65, 0.6, true)).toBeGreaterThan(0.5);
  });
});

describe('matchFromSetProb', () => {
  it('is a coin flip at an even set, for both formats', () => {
    expect(matchFromSetProb(0.5, 3).win).toBeCloseTo(0.5, 12);
    expect(matchFromSetProb(0.5, 5).win).toBeCloseTo(0.5, 12);
  });

  it('matches the closed forms and sums to one', () => {
    for (const s of [0.3, 0.45, 0.6, 0.75, 0.9]) {
      const bo3 = matchFromSetProb(s, 3);
      const bo5 = matchFromSetProb(s, 5);
      expect(bo3.win).toBeCloseTo(3 * s ** 2 - 2 * s ** 3, 10);
      expect(bo5.win).toBeCloseTo(10 * s ** 3 - 15 * s ** 4 + 6 * s ** 5, 10);
      expect(bo3.dist.reduce((t, d) => t + d.p, 0)).toBeCloseTo(1, 10);
      expect(bo5.dist.reduce((t, d) => t + d.p, 0)).toBeCloseTo(1, 10);
    }
  });

  it('never produces a level set score', () => {
    for (const bestOf of [3, 5] as const) {
      for (const d of matchFromSetProb(0.6, bestOf).dist) expect(d.home).not.toBe(d.away);
    }
  });
});

describe('markovForecast', () => {
  it('amplifies a small serve edge up the chain', () => {
    // The reason this model is worth having over a rating: two points of serve
    // becomes a far larger edge on the match.
    const f = markovForecast(0.65, 0.6, 3);
    const pointEdge = Math.abs(0.65 - 0.6);
    const holdEdge = Math.abs(f.hold.home - f.hold.away);
    const setEdge = Math.abs(f.setProb - 0.5);
    const matchEdge = Math.abs((f.probs.HOME as number) - 0.5);
    expect(holdEdge).toBeGreaterThan(pointEdge);
    expect(setEdge).toBeGreaterThan(pointEdge);
    expect(matchEdge).toBeGreaterThan(setEdge);
    expect(f.probs.HOME).toBeGreaterThan(0.65);
  });

  it('returns a legal set score and consistent expectations', () => {
    const f = markovForecast(0.65, 0.6, 3);
    expect([f.score.mostLikely.home, f.score.mostLikely.away].includes(2)).toBe(true);
    expect(f.score.mostLikely.home).not.toBe(f.score.mostLikely.away);
    const total = f.score.expected.home + f.score.expected.away;
    expect(total).toBeGreaterThan(2);
    expect(total).toBeLessThan(3);
    expect((f.probs.HOME as number) + (f.probs.AWAY as number)).toBeCloseTo(1, 10);
  });

  it('is exactly even for identical players', () => {
    const f = markovForecast(0.62, 0.62, 3);
    expect(f.probs.HOME).toBeCloseTo(0.5, 8);
    expect(f.score.expected.home).toBeCloseTo(f.score.expected.away, 6);
  });

  it('agrees with a simulation of the real rules', () => {
    // An independent check of the whole recursion stack: play the match out
    // point by point and compare the observed win rate with the closed form.
    const pHome = 0.66;
    const pAway = 0.6;
    const random = rng(20_260_921);
    const playGame = (p: number): boolean => {
      let server = 0;
      let receiver = 0;
      for (;;) {
        if (random() < p) server += 1;
        else receiver += 1;
        if (server >= 4 && server - receiver >= 2) return true;
        if (receiver >= 4 && receiver - server >= 2) return false;
      }
    };
    const playTiebreak = (homeFirst: boolean): boolean => {
      let a = 0;
      let b = 0;
      for (;;) {
        const n = a + b;
        const even = Math.floor((n + 1) / 2) % 2 === 0;
        const homeServes = homeFirst ? even : !even;
        const won = homeServes ? random() < pHome : random() >= pAway;
        if (won) a += 1;
        else b += 1;
        if (a >= 7 && a - b >= 2) return true;
        if (b >= 7 && b - a >= 2) return false;
      }
    };
    const playSet = (homeFirst: boolean): boolean => {
      let a = 0;
      let b = 0;
      for (;;) {
        if (a === 6 && b === 6) return playTiebreak(homeFirst);
        const homeServes = ((a + b) % 2 === 0) === homeFirst;
        const homeWonGame = homeServes ? playGame(pHome) : !playGame(pAway);
        if (homeWonGame) a += 1;
        else b += 1;
        if (a >= 6 && a - b >= 2) return true;
        if (b >= 6 && b - a >= 2) return false;
      }
    };
    const runs = 40_000;
    let wins = 0;
    for (let i = 0; i < runs; i += 1) {
      // The toss decides who opens, which is what setWinAveraged averages over.
      let sets = 0;
      let lost = 0;
      let homeFirst = random() < 0.5;
      while (sets < 2 && lost < 2) {
        if (playSet(homeFirst)) sets += 1;
        else lost += 1;
        homeFirst = !homeFirst;
      }
      if (sets === 2) wins += 1;
    }
    const simulated = wins / runs;
    const predicted = markovForecast(pHome, pAway, 3).probs.HOME as number;
    expect(Math.abs(simulated - predicted)).toBeLessThan(0.012);
  });
});

describe('parseTennisFormat', () => {
  it('reads the surface and the best-of', () => {
    expect(parseTennisFormat('Hard BO3')).toEqual({ surface: 'Hard', bestOf: 3 });
    expect(parseTennisFormat('Clay BO5')).toEqual({ surface: 'Clay', bestOf: 5 });
    expect(parseTennisFormat('Grass BO3')).toEqual({ surface: 'Grass', bestOf: 3 });
  });

  it('falls back safely on anything unreadable', () => {
    expect(parseTennisFormat('BO3')).toEqual({ surface: 'Hard', bestOf: 3 });
    expect(parseTennisFormat(null)).toEqual({ surface: 'Hard', bestOf: 3 });
    expect(parseTennisFormat('nonsense')).toEqual({ surface: 'Hard', bestOf: 3 });
  });
});
