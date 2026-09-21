import { describe, expect, it } from 'vitest';

import { dcRates, fitDixonColes, type DcMatch } from '@/lib/engine/dixon-coles';
import { DEFAULT_ELO_PARAMS, calibrateDrawBase, computeElo, eloOutcomeProbs, eloPredict, marginMultiplier, type EloMatch } from '@/lib/engine/elo';
import { fitLogistic, predictLogistic } from '@/lib/engine/logistic';
import { fitStats, forecastStats, type StatSample } from '@/lib/engine/stats-model';
import { gridOutcomes, scoreGrid } from '@/lib/engine/poisson';
import { poisson, rng } from '@/lib/providers/mock/generator';
import { defaultModelSettings } from '@/lib/engine/config';
import { score, summarise } from '@/lib/engine/metrics';
import { SPORTS } from '@/lib/sports/registry';

/** A synthetic league with known strengths, so the fitters have a truth to recover. */
function league(seed: number, rounds = 30) {
  const random = rng(seed);
  const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const attack = { A: 1.5, B: 1.3, C: 1.1, D: 1.0, E: 0.95, F: 0.9, G: 0.8, H: 0.7 } as Record<string, number>;
  const defence = { A: 0.7, B: 0.85, C: 0.95, D: 1.0, E: 1.05, F: 1.1, G: 1.2, H: 1.3 } as Record<string, number>;
  const matches: DcMatch[] = [];
  const start = Date.UTC(2024, 7, 1);
  for (let r = 0; r < rounds; r += 1) {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away || (r + teams.indexOf(home)) % 2 !== 0) continue;
        const lambdaHome = 1.3 * attack[home] * defence[away] * 1.25;
        const lambdaAway = 1.3 * attack[away] * defence[home];
        matches.push({ home, away, homeGoals: poisson(lambdaHome, random), awayGoals: poisson(lambdaAway, random), date: new Date(start + r * 7 * 86_400_000 + teams.indexOf(home) * 3_600_000) });
      }
    }
  }
  return { teams, matches, attack, defence };
}

describe('fitDixonColes', () => {
  it('recovers the ordering of team strengths and a home advantage', () => {
    const { matches, attack, defence } = league(11, 40);
    const state = fitDixonColes(matches, new Date('2026-01-01T00:00:00Z'), { xi: 0, maxIterations: 400, l2: 0.01, maxAgeDays: 5_000 });
    expect(state.matches).toBe(matches.length);
    expect(state.home).toBeGreaterThan(0.1);
    expect(state.home).toBeLessThan(0.4);
    // The strongest attack and the weakest attack come out in the right order.
    expect(state.attack.A).toBeGreaterThan(state.attack.H);
    expect(state.defence.H).toBeGreaterThan(state.defence.A);
    const ranked = Object.entries(state.attack).sort((x, y) => y[1] - x[1]).map(([t]) => t);
    expect(ranked.indexOf('A')).toBeLessThan(3);
    expect(ranked.indexOf('H')).toBeGreaterThan(4);
    // Expected goals in the fixture A v H are far apart, and reflect the truth roughly.
    const { lambdaHome, lambdaAway } = dcRates(state, 'A', 'H');
    expect(lambdaHome).toBeGreaterThan(lambdaAway * 2);
    expect(lambdaHome).toBeGreaterThan(1.3 * attack.A * defence.H * 0.8);
    const probs = gridOutcomes(scoreGrid(lambdaHome, lambdaAway, state.rho));
    expect(probs.HOME).toBeGreaterThan(0.6);
  });

  it('returns a neutral state for tiny samples and treats unknown teams as average', () => {
    const state = fitDixonColes([], new Date());
    const { lambdaHome, lambdaAway } = dcRates(state, 'X', 'Y');
    expect(lambdaHome).toBeGreaterThan(lambdaAway);
    expect(lambdaAway).toBeCloseTo(1.3, 1);
  });
});

describe('Elo', () => {
  it('rewards winners, scales by margin and regresses at a new season', () => {
    const matches: EloMatch[] = [
      { home: 'A', away: 'B', homeScore: 3, awayScore: 0, date: new Date('2025-01-01'), season: '2024' },
      { home: 'B', away: 'A', homeScore: 0, awayScore: 1, date: new Date('2025-01-08'), season: '2024' },
    ];
    const state = computeElo(matches);
    expect(state.ratings.A).toBeGreaterThan(1500);
    expect(state.ratings.B).toBeLessThan(1500);
    expect(state.ratings.A + state.ratings.B).toBeCloseTo(3000, 6);
    expect(marginMultiplier(3, 0)).toBeGreaterThan(marginMultiplier(1, 0));
    const before = state.ratings.A;
    const next = computeElo([{ home: 'A', away: 'B', homeScore: 1, awayScore: 1, date: new Date('2025-09-01'), season: '2025' }], DEFAULT_ELO_PARAMS, state);
    // Regressed a third of the way back before the draw moved them slightly toward each other.
    expect(next.ratings.A).toBeLessThan(before);
  });

  it('turns a gap into probabilities that sum to one, with draws highest when level', () => {
    const level = eloOutcomeProbs(-DEFAULT_ELO_PARAMS.homeAdvantage, DEFAULT_ELO_PARAMS, true);
    const gap = eloOutcomeProbs(300, DEFAULT_ELO_PARAMS, true);
    expect(level.HOME + level.DRAW + level.AWAY).toBeCloseTo(1, 10);
    expect(level.DRAW).toBeGreaterThan(gap.DRAW);
    expect(gap.HOME).toBeGreaterThan(0.7);
    const noDraw = eloOutcomeProbs(0, DEFAULT_ELO_PARAMS, false);
    expect(noDraw.DRAW).toBeUndefined();
    expect(noDraw.HOME).toBeGreaterThan(0.5);
  });

  it('calibrates the draw base to the observed draw rate', () => {
    const { matches } = league(5, 40);
    const elo: EloMatch[] = matches.map((m) => ({ home: m.home, away: m.away, homeScore: m.homeGoals, awayScore: m.awayGoals, date: m.date, season: '2024' }));
    const drawBase = calibrateDrawBase(elo, DEFAULT_ELO_PARAMS);
    const observed = elo.filter((m) => m.homeScore === m.awayScore).length / elo.length;
    const state = computeElo(elo, { ...DEFAULT_ELO_PARAMS, drawBase });
    const modelled = elo.reduce((s, m) => s + eloPredict(state, m.home, m.away, true).DRAW, 0) / elo.length;
    expect(Math.abs(modelled - observed)).toBeLessThan(0.05);
  });
});

describe('fitStats', () => {
  it('forecasts more of a stat for the team that produces more of it', () => {
    const samples: StatSample[] = [];
    const start = Date.UTC(2025, 0, 1);
    for (let i = 0; i < 40; i += 1) {
      const date = new Date(start + i * 7 * 86_400_000);
      samples.push({ team: 'Big', opponent: 'Small', home: i % 2 === 0, date, stats: { shots: 16 + (i % 3), possession: 62, passes: 560 } });
      samples.push({ team: 'Small', opponent: 'Big', home: i % 2 !== 0, date, stats: { shots: 8 + (i % 2), possession: 38, passes: 340 } });
      samples.push({ team: 'Mid', opponent: 'Other', home: true, date, stats: { shots: 12, possession: 50, passes: 450 } });
      samples.push({ team: 'Other', opponent: 'Mid', home: false, date, stats: { shots: 11, possession: 50, passes: 440 } });
    }
    const defs = SPORTS[0].stats.filter((s) => ['shots', 'possession', 'passes'].includes(s.key));
    const state = fitStats(samples, defs.map((d) => d.key), new Date('2026-01-01'));
    const forecast = forecastStats(state, 'Big', 'Small', defs);
    expect(forecast.shots.home.mean).toBeGreaterThan(forecast.shots.away.mean);
    expect(forecast.shots.home.low).toBeLessThanOrEqual(forecast.shots.home.mean);
    expect(forecast.shots.home.high).toBeGreaterThanOrEqual(forecast.shots.home.mean);
    expect(forecast.possession.home.mean + forecast.possession.away.mean).toBeCloseTo(100, 6);
    expect(forecast.possession.home.mean).toBeGreaterThan(55);
    expect(forecast.passes.home.mean).toBeGreaterThan(forecast.passes.away.mean + 100);
    // An unknown team sits at the league average.
    const neutral = forecastStats(state, 'New', 'Other', defs);
    expect(neutral.shots.home.mean).toBeGreaterThan(9);
    expect(neutral.shots.home.mean).toBeLessThan(15);
  });
});

describe('fitLogistic', () => {
  it('learns a separable pattern and returns calibrated-looking probabilities', () => {
    const random = rng(3);
    const rows = Array.from({ length: 600 }, () => {
      const edge = (random() - 0.5) * 2;
      const noise = (random() - 0.5) * 0.8;
      const z = edge * 2 + noise;
      const outcome = z > 0.5 ? 'HOME' : z < -0.5 ? 'AWAY' : 'DRAW';
      return { features: { edge, junk: random() }, outcome };
    });
    const state = fitLogistic(rows, ['HOME', 'DRAW', 'AWAY'], ['edge', 'junk']);
    const strong = predictLogistic(state, { edge: 0.9, junk: 0.5 });
    const weak = predictLogistic(state, { edge: -0.9, junk: 0.5 });
    const level = predictLogistic(state, { edge: 0, junk: 0.5 });
    expect(strong.HOME).toBeGreaterThan(0.7);
    expect(weak.AWAY).toBeGreaterThan(0.7);
    expect(level.DRAW).toBeGreaterThan(level.HOME);
    expect(strong.HOME + strong.DRAW + strong.AWAY).toBeCloseTo(1, 8);
  });
});

describe('model configuration per sport', () => {
  it('leaves every other sport exactly as it was', () => {
    // The tennis work must not reach football, rugby or Formula 1.
    expect(defaultModelSettings('football').map((m) => m.key)).toEqual(['baseline', 'elo', 'dixon-coles', 'stats', 'ml', 'market', 'ai', 'ensemble']);
    expect(defaultModelSettings('rugby_union').map((m) => m.key)).toEqual(['baseline', 'elo', 'margin', 'stats', 'ml', 'market', 'ai', 'ensemble']);
    expect(defaultModelSettings('f1').map((m) => m.key)).toEqual(['baseline', 'elo', 'race-sim', 'stats', 'ml', 'market', 'ai', 'ensemble']);
    expect(defaultModelSettings('cricket').map((m) => m.key)).not.toContain('rank');
  });

  it('gives tennis the ranking and Markov models', () => {
    const keys = defaultModelSettings('tennis').map((m) => m.key);
    expect(keys).toContain('rank');
    expect(keys).toContain('markov');
    // A model missing from the sport definition is computed but never shown.
    const tennis = SPORTS.find((s) => s.key === 'tennis');
    expect(tennis?.models).toContain('rank');
    expect(tennis?.models).toContain('markov');
  });

  it('only seeds ratings from a ranking where a ranking exists', () => {
    const tennisElo = defaultModelSettings('tennis').find((m) => m.key === 'elo');
    expect((tennisElo?.params as { seedFromRank?: boolean }).seedFromRank).toBe(true);
    const footballElo = defaultModelSettings('football').find((m) => m.key === 'elo');
    expect((footballElo?.params as { seedFromRank?: boolean }).seedFromRank).toBeUndefined();
  });
});

describe('score', () => {
  it('does not credit the first outcome when the call was a dead heat', () => {
    // The old behaviour silently marked every 50/50 as a pick for whichever
    // name sorted first, inflating accuracy on exactly the matches it knew least about.
    const home = score([0.5, 0.5], 0);
    const away = score([0.5, 0.5], 1);
    expect(home.tied).toBe(true);
    expect(away.tied).toBe(true);
    expect(home.correct).toBe(false);
    expect(away.correct).toBe(false);
  });

  it('still scores a real call', () => {
    expect(score([0.6, 0.4], 0)).toMatchObject({ correct: true, tied: false });
    expect(score([0.6, 0.4], 1)).toMatchObject({ correct: false, tied: false });
  });

  it('takes accuracy over the calls that were actually made', () => {
    const scores = [score([0.6, 0.4], 0), score([0.6, 0.4], 0), score([0.7, 0.3], 1), score([0.3, 0.7], 0), score([0.5, 0.5], 0), score([0.5, 0.5], 1)];
    const summary = summarise(scores);
    expect(summary.n).toBe(6);
    expect(summary.ties).toBe(2);
    expect(summary.accuracy).toBe(0.5);
  });
});

describe('unscoreable outcomes', () => {
  it('refuses an outcome the sport does not have rather than charging a maximum miss', () => {
    // Tennis walkovers arrive as 0-0, which resolves to a draw in a sport with
    // no draw. Passing that through as index -1 read a probability of zero and
    // charged every model roughly fourteen nats, wrecking log loss and driving
    // the temperature fit to its ceiling.
    expect(() => score([0.6, 0.4], -1)).toThrow(/outside/);
    expect(() => score([0.6, 0.4], 2)).toThrow(/outside/);
    expect(() => score([0.6, 0.4], 1)).not.toThrow();
  });
});
