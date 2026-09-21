/**
 * A set score that is actually possible.
 *
 * The Markov model produces a set distribution directly, but it needs serve
 * statistics. When those are missing, any match win probability still implies
 * one: invert the best-of formula for the per-set chance, then read the set
 * scores back off it. Either way a tennis match ends 2-0 or 2-1, never 1-1.
 */

import { matchFromSetProb } from '@/lib/engine/sports/tennis-markov';
import type { SportDefinition } from '@/lib/sports/registry';
import type { ScoreForecast } from '@/lib/types';

/**
 * Recover the per-set probability from the match probability.
 *
 * Both curves are strictly increasing on [0, 1], so bisection is safe and
 * needs no starting guess:
 *   best of three: 3s^2 - 2s^3,  derivative 6s(1 - s) >= 0
 *   best of five: 10s^3 - 15s^4 + 6s^5,  derivative 30s^2(1 - s)^2 >= 0
 */
export function setProbFromMatchProb(matchProb: number, bestOf: 3 | 5): number {
  const target = Math.min(1, Math.max(0, matchProb));
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (matchFromSetProb(mid, bestOf).win < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** A set-score forecast from a match win probability alone. */
export function setScoreForecast(matchProb: number, bestOf: 3 | 5): ScoreForecast {
  const setProb = setProbFromMatchProb(matchProb, bestOf);
  const { dist } = matchFromSetProb(setProb, bestOf);
  const sorted = [...dist].sort((a, b) => b.p - a.p);
  const expectedHome = dist.reduce((sum, d) => sum + d.p * d.home, 0);
  const expectedAway = dist.reduce((sum, d) => sum + d.p * d.away, 0);
  const decider = dist.filter((d) => Math.min(d.home, d.away) === (bestOf === 3 ? 1 : 2)).reduce((sum, d) => sum + d.p, 0);
  return {
    expected: { home: round2(expectedHome), away: round2(expectedAway) },
    mostLikely: { home: sorted[0].home, away: sorted[0].away, p: round4(sorted[0].p) },
    top: sorted.map((d) => ({ home: d.home, away: d.away, p: round4(d.p) })),
    lines: { setHome: round4(setProb), straightSets: round4(1 - decider), decider: round4(decider) },
  };
}

/**
 * Keep a language model from writing an impossible scoreline.
 *
 * In AI and hybrid mode the model may return its own expected score, which is
 * only validated as two integers. For a sport played to a fixed number of
 * sets, exactly one side must reach that number and the other must fall short,
 * so anything else is rejected and the computed forecast stands. Every other
 * sport passes through untouched.
 */
export function snapToLegalScore(
  score: { home: number; away: number },
  sport: SportDefinition,
  bestOf: 3 | 5,
): { home: number; away: number } | null {
  if (sport.shape !== 'PLAYER_VS_PLAYER' || sport.scoreLabel !== 'sets') return score;
  const target = bestOf === 3 ? 2 : 3;
  const { home, away } = score;
  if (!Number.isInteger(home) || !Number.isInteger(away)) return null;
  if (home === target && away >= 0 && away < target) return { home, away };
  if (away === target && home >= 0 && home < target) return { home, away };
  return null;
}
