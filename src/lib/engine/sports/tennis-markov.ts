/**
 * Tennis as a chain of probabilities.
 *
 * Everything here is driven by one number per player: the chance of winning a
 * point on their own serve. From that the chain climbs, point to game to
 * tiebreak to set to match. Each rung is exact, not simulated.
 *
 * The chain matters because tennis scoring amplifies. A player winning 65% of
 * serve points rather than 60% holds 83% of the time rather than 74%, and wins
 * the match 72% of the time rather than 50%. A two-point edge on serve becomes
 * a twenty-point edge on the match, which is precisely the separation a rating
 * alone cannot see.
 *
 * Sets are treated as independent given the serve rates. That ignores momentum
 * and who serves first in each set, and is the standard simplification.
 */

import { clamp } from '@/lib/engine/math';
import type { ProbMap, ScoreForecast } from '@/lib/types';

/** Chance of taking a game from deuce, winning the two-point cycle. */
export function deuceWin(p: number): number {
  const q = 1 - p;
  const denom = p * p + q * q;
  if (denom <= 0) return p >= 0.5 ? 1 : 0;
  return (p * p) / denom;
}

function choose(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return result;
}

/**
 * Chance of holding serve, given the chance of winning a point on serve.
 * Wins to love, to 15 and to 30, plus reaching deuce and taking it.
 */
export function gameWin(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const q = 1 - p;
  let straight = 0;
  for (let lost = 0; lost <= 2; lost += 1) straight += choose(3 + lost, lost) * p ** 4 * q ** lost;
  const toDeuce = choose(6, 3) * p ** 3 * q ** 3;
  return straight + toDeuce * deuceWin(p);
}

/**
 * A tiebreak: first to `target`, win by two, serve alternating in pairs after
 * the opening point. `a` opens serving, then b, b, a, a, b, b and so on, so
 * after n points a serves again when floor((n + 1) / 2) is even.
 */
export function tiebreakWin(pA: number, pB: number, aServesFirst = true, target = 7): number {
  const memo = new Map<string, number>();
  const aServesAt = (n: number): boolean => {
    const even = Math.floor((n + 1) / 2) % 2 === 0;
    return aServesFirst ? even : !even;
  };
  const walk = (a: number, b: number): number => {
    if (a >= target && a - b >= 2) return 1;
    if (b >= target && b - a >= 2) return 0;
    // At the level score the next two points are served one each, so the same
    // two-point cycle as deuce applies: a must take their serve and break back.
    if (a >= target - 1 && b >= target - 1 && a === b) {
      const s = pA;
      const r = 1 - pB;
      const denom = s * r + (1 - s) * (1 - r);
      return denom <= 0 ? 0.5 : (s * r) / denom;
    }
    const key = `${a}:${b}`;
    const seen = memo.get(key);
    if (seen !== undefined) return seen;
    const win = aServesAt(a + b) ? pA : 1 - pB;
    const value = win * walk(a + 1, b) + (1 - win) * walk(a, b + 1);
    memo.set(key, value);
    return value;
  };
  return walk(0, 0);
}

/**
 * A set: first to six games, win by two, tiebreak at six all. `a` serves the
 * first game and they alternate, so a serves whenever the games played so far
 * is even.
 */
export function setWin(pA: number, pB: number, aServesFirst: boolean): number {
  const holdA = gameWin(pA);
  const holdB = gameWin(pB);
  const memo = new Map<string, number>();
  const walk = (a: number, b: number): number => {
    if (a >= 6 && a - b >= 2) return 1;
    if (b >= 6 && b - a >= 2) return 0;
    // The thirteenth game has the same server as the first, so the tiebreak
    // opens with whoever opened the set.
    if (a === 6 && b === 6) return tiebreakWin(pA, pB, aServesFirst);
    const key = `${a}:${b}`;
    const seen = memo.get(key);
    if (seen !== undefined) return seen;
    const aServes = ((a + b) % 2 === 0) === aServesFirst;
    const win = aServes ? holdA : 1 - holdB;
    const value = win * walk(a + 1, b) + (1 - win) * walk(a, b + 1);
    memo.set(key, value);
    return value;
  };
  return walk(0, 0);
}

/** Who serves first alternates with the toss, so average over both. */
export function setWinAveraged(pA: number, pB: number): number {
  return 0.5 * (setWin(pA, pB, true) + setWin(pA, pB, false));
}

export interface SetScore {
  home: number;
  away: number;
  p: number;
}

/**
 * Match win chance and the full set-score distribution, from the chance of
 * winning a single set. Best of three ends 2-0 or 2-1, best of five 3-0, 3-1
 * or 3-2, so an even scoreline is impossible and never appears here.
 */
export function matchFromSetProb(s: number, bestOf: 3 | 5): { win: number; dist: SetScore[] } {
  const t = 1 - s;
  const dist: SetScore[] = [];
  if (bestOf === 3) {
    dist.push({ home: 2, away: 0, p: s * s });
    dist.push({ home: 2, away: 1, p: 2 * s * s * t });
    dist.push({ home: 1, away: 2, p: 2 * t * t * s });
    dist.push({ home: 0, away: 2, p: t * t });
  } else {
    dist.push({ home: 3, away: 0, p: s ** 3 });
    dist.push({ home: 3, away: 1, p: 3 * s ** 3 * t });
    dist.push({ home: 3, away: 2, p: 6 * s ** 3 * t * t });
    dist.push({ home: 2, away: 3, p: 6 * t ** 3 * s * s });
    dist.push({ home: 1, away: 3, p: 3 * t ** 3 * s });
    dist.push({ home: 0, away: 3, p: t ** 3 });
  }
  const win = dist.filter((d) => d.home > d.away).reduce((sum, d) => sum + d.p, 0);
  return { win, dist };
}

export interface MarkovForecast {
  probs: ProbMap;
  score: ScoreForecast;
  setProb: number;
  hold: { home: number; away: number };
  point: { home: number; away: number };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

/** Build a forecast from both players' serve-point win rates. */
export function markovForecast(pHome: number, pAway: number, bestOf: 3 | 5): MarkovForecast {
  const setProb = setWinAveraged(pHome, pAway);
  const { win, dist } = matchFromSetProb(setProb, bestOf);
  const sorted = [...dist].sort((a, b) => b.p - a.p);
  const expectedHome = dist.reduce((sum, d) => sum + d.p * d.home, 0);
  const expectedAway = dist.reduce((sum, d) => sum + d.p * d.away, 0);
  const holdHome = gameWin(pHome);
  const holdAway = gameWin(pAway);
  const decider = dist.filter((d) => Math.min(d.home, d.away) === (bestOf === 3 ? 1 : 2)).reduce((sum, d) => sum + d.p, 0);
  return {
    probs: { HOME: win, AWAY: 1 - win },
    setProb,
    hold: { home: holdHome, away: holdAway },
    point: { home: pHome, away: pAway },
    score: {
      expected: { home: round2(expectedHome), away: round2(expectedAway) },
      mostLikely: { home: sorted[0].home, away: sorted[0].away, p: round4(sorted[0].p) },
      top: sorted.map((d) => ({ home: d.home, away: d.away, p: round4(d.p) })),
      lines: {
        setHome: round4(setProb),
        holdHome: round4(holdHome),
        holdAway: round4(holdAway),
        pointHome: round4(pHome),
        pointAway: round4(pAway),
        straightSets: round4(1 - decider),
        decider: round4(decider),
      },
    },
  };
}

/** `"Hard BO3"` -> surface and best-of. Anything unreadable becomes hard court, best of three. */
export function parseTennisFormat(format: string | null | undefined): { surface: string; bestOf: 3 | 5 } {
  const bestOf = format && /BO5/i.test(format) ? 5 : 3;
  const surface = format ? (format.match(/^([A-Za-z]+)/)?.[1] ?? 'Hard') : 'Hard';
  const known = ['Hard', 'Clay', 'Grass', 'Carpet'];
  const matched = known.find((s) => s.toLowerCase() === surface.toLowerCase());
  return { surface: matched ?? 'Hard', bestOf: bestOf as 3 | 5 };
}

/** Serve rates outside this band are not tennis; they are a parsing error. */
export function clampServeRate(p: number): number {
  return clamp(p, 0.35, 0.9);
}
