import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVE_PARAMS, fitServeReturn, matchServeProbs, serveSamplesFrom, type ServeSample } from '@/lib/engine/sports/tennis-serve';
import { breakTie, evidenceFor } from '@/lib/engine/tiebreak';
import type { HistoryMatch } from '@/lib/engine/history';
import { rng } from '@/lib/providers/mock/generator';

/** A synthetic tour with known true serve rates, so the fitter has a truth to recover. */
function tour(seed: number, matchesEach = 60) {
  const random = rng(seed);
  const players = Array.from({ length: 20 }, (_, i) => `p${i}`);
  const trueServe = new Map(players.map((p, i) => [p, 0.55 + (i / 19) * 0.17]));
  const samples: ServeSample[] = [];
  const start = Date.UTC(2025, 0, 1);
  for (let round = 0; round < matchesEach; round += 1) {
    for (let i = 0; i < players.length; i += 2) {
      const a = players[i];
      const b = players[(i + 1 + round) % players.length];
      if (a === b) continue;
      const date = new Date(start + round * 5 * 86_400_000);
      const draw = (p: number, n: number) => {
        let won = 0;
        for (let k = 0; k < n; k += 1) if (random() < p) won += 1;
        return won;
      };
      const aPts = 70;
      const bPts = 70;
      const aWon = draw(trueServe.get(a) as number, aPts);
      const bWon = draw(trueServe.get(b) as number, bPts);
      samples.push({ player: a, opponent: b, date, surface: 'Hard', servePoints: aPts, servePointsWon: aWon, returnPoints: bPts, returnPointsWon: bPts - bWon });
      samples.push({ player: b, opponent: a, date, surface: 'Hard', servePoints: bPts, servePointsWon: bWon, returnPoints: aPts, returnPointsWon: aPts - aWon });
    }
  }
  return { players, trueServe, samples };
}

describe('fitServeReturn', () => {
  const asOf = new Date('2026-01-01T00:00:00Z');

  it('recovers the ordering and the level of each player', () => {
    const { players, trueServe, samples } = tour(7);
    const state = fitServeReturn(samples, asOf);
    const best = players[players.length - 1];
    const worst = players[0];
    expect(state.serve[best]['']).toBeGreaterThan(state.serve[worst]['']);
    for (const p of players) {
      expect(state.serve[p]['']).toBeCloseTo(trueServe.get(p) as number, 1);
    }
    expect(state.tour['']).toBeGreaterThan(0.55);
    expect(state.tour['']).toBeLessThan(0.75);
  });

  it('holds a barely-seen player close to the tour average', () => {
    const state = fitServeReturn(
      [{ player: 'rookie', opponent: 'x', date: new Date('2025-12-01T00:00:00Z'), surface: 'Hard', servePoints: 60, servePointsWon: 55, returnPoints: 60, returnPointsWon: 5 }],
      asOf,
    );
    // Five sixths of serve points won is not believable from one match.
    expect(state.serve.rookie['']).toBeLessThan(0.7);
    expect(state.points.rookie).toBeLessThan(70);
  });

  it('ignores a part-played match when building samples from history', () => {
    const base: HistoryMatch = {
      id: 'a',
      competitionId: 'c',
      season: '2026',
      date: new Date('2026-02-01T00:00:00Z'),
      home: 'h',
      away: 'a',
      homeScore: 2,
      awayScore: 0,
      format: 'Hard BO3',
      stats: { home: { servePoints: 70, servePointsWon: 45 }, away: { servePoints: 68, servePointsWon: 40 } },
    };
    expect(serveSamplesFrom([base])).toHaveLength(2);
    const retired = { ...base, stats: { home: { servePoints: 12, servePointsWon: 8 }, away: { servePoints: 10, servePointsWon: 6 } } };
    expect(serveSamplesFrom([retired])).toHaveLength(0);
    const missing = { ...base, stats: { home: null, away: null } };
    expect(serveSamplesFrom([missing])).toHaveLength(0);
  });
});

describe('matchServeProbs', () => {
  const asOf = new Date('2026-01-01T00:00:00Z');

  it('returns the tour average for two average players', () => {
    const { samples } = tour(11);
    const state = fitServeReturn(samples, asOf);
    // Invent two players sitting exactly on the tour rates for this surface.
    const mean = state.tour.Hard;
    state.serve.avgA = { '': mean, Hard: mean };
    state.serve.avgB = { '': mean, Hard: mean };
    state.ret.avgA = { '': 1 - mean, Hard: 1 - mean };
    state.ret.avgB = { '': 1 - mean, Hard: 1 - mean };
    state.points.avgA = 5000;
    state.points.avgB = 5000;
    const probs = matchServeProbs(state, 'avgA', 'avgB', 'Hard');
    expect(probs).not.toBeNull();
    expect(probs?.home).toBeCloseTo(mean, 6);
    expect(probs?.away).toBeCloseTo(mean, 6);
  });

  it('stands down when a player is too thinly sampled', () => {
    const { samples } = tour(13);
    const state = fitServeReturn(samples, asOf);
    state.points.newcomer = 10;
    state.serve.newcomer = { '': 0.6 };
    state.ret.newcomer = { '': 0.4 };
    expect(matchServeProbs(state, 'newcomer', 'p1', 'Hard')).toBeNull();
    expect(matchServeProbs(state, 'p1', 'newcomer', 'Hard')).toBeNull();
  });

  it('gives the stronger server the higher rate', () => {
    const { players, samples } = tour(17);
    const state = fitServeReturn(samples, asOf);
    const probs = matchServeProbs(state, players[19], players[0], 'Hard', DEFAULT_SERVE_PARAMS);
    expect(probs).not.toBeNull();
    expect(probs?.home).toBeGreaterThan(probs?.away as number);
  });
});

describe('evidenceFor', () => {
  it('calls a well-covered pairing strong', () => {
    const e = evidenceFor({ homeMatches: 40, awayMatches: 25, ranked: { home: true, away: true }, serveStats: { home: true, away: true } });
    expect(e.level).toBe('strong');
    expect(e.factor).toBe(1);
    expect(e.notes).toHaveLength(0);
  });

  it('flags two ranked players with no match history', () => {
    const e = evidenceFor({ homeMatches: 0, awayMatches: 0, ranked: { home: true, away: true }, serveStats: { home: false, away: false }, homeName: 'A', awayName: 'B' });
    expect(e.level).toBe('none');
    expect(e.factor).toBeLessThan(0.5);
    expect(e.notes.join(' ')).toContain('0 matches on record for A');
  });

  it('names the unranked player', () => {
    const e = evidenceFor({ homeMatches: 10, awayMatches: 10, ranked: { home: true, away: false }, serveStats: { home: true, away: true }, homeName: 'A', awayName: 'B' });
    expect(e.notes.join(' ')).toContain('No published ranking for B');
    expect(e.level).toBe('moderate');
  });
});

describe('breakTie', () => {
  const base = {
    probs: { HOME: 0.5, AWAY: 0.5 },
    home: 'team-a',
    away: 'team-b',
    epsilon: 0.01,
    nudge: 0.005,
    rank: { home: null as number | null, away: null as number | null },
    form: { home: 0.5, away: 0.5 },
    h2h: 0,
    matches: { home: 0, away: 0 },
  };

  it('leaves a decided match untouched', () => {
    const out = breakTie({ ...base, probs: { HOME: 0.62, AWAY: 0.38 } });
    expect(out.broken).toBe(false);
    expect(out.favourite).toBe('HOME');
    expect(out.probs).toEqual({ HOME: 0.62, AWAY: 0.38 });
  });

  it('prefers the better ranking above everything else', () => {
    const out = breakTie({ ...base, rank: { home: 166, away: 96 }, form: { home: 0.9, away: 0.1 }, h2h: 5 });
    expect(out.broken).toBe(true);
    expect(out.favourite).toBe('AWAY');
    expect(out.reason).toBe('ranked #96 against #166');
    expect(out.probs.AWAY).toBeGreaterThan(out.probs.HOME as number);
  });

  it('falls through the cascade in order', () => {
    expect(breakTie({ ...base, form: { home: 0.7, away: 0.4 } }).reason).toBe('better recent form');
    expect(breakTie({ ...base, h2h: -2 }).favourite).toBe('AWAY');
    expect(breakTie({ ...base, h2h: -2 }).reason).toBe('leads the head-to-head');
    expect(breakTie({ ...base, matches: { home: 9, away: 2 } }).reason).toBe('more matches on record');
  });

  it('is deterministic and order independent when nothing separates them', () => {
    const one = breakTie(base);
    const two = breakTie(base);
    expect(one).toEqual(two);
    expect(one.reason).toBe('nothing separates them');
    // The same pairing must pick the same competitor whichever id arrives first.
    const swapped = breakTie({ ...base, home: base.away, away: base.home });
    const chosen = one.favourite === 'HOME' ? base.home : base.away;
    const chosenSwapped = swapped.favourite === 'HOME' ? base.away : base.home;
    expect(chosenSwapped).toBe(chosen);
  });

  it('does not favour one side across many pairings', () => {
    // A name or id comparison would hand every unresolvable match to the same
    // half of the alphabet; the pair hash must not.
    let homeWins = 0;
    const runs = 2000;
    for (let i = 0; i < runs; i += 1) {
      const out = breakTie({ ...base, home: `player-${i}-x`, away: `player-${i}-y` });
      if (out.favourite === 'HOME') homeWins += 1;
    }
    expect(homeWins / runs).toBeGreaterThan(0.45);
    expect(homeWins / runs).toBeLessThan(0.55);
  });

  it('nudges only slightly', () => {
    const out = breakTie({ ...base, rank: { home: 10, away: 200 } });
    expect(out.probs.HOME as number).toBeGreaterThan(0.5);
    expect(out.probs.HOME as number).toBeLessThan(0.52);
    expect((out.probs.HOME as number) + (out.probs.AWAY as number)).toBeCloseTo(1, 10);
  });
});
