/**
 * Serve and return rates per player, which is what the Markov chain runs on.
 *
 * Two levels of shrinkage. A player's overall rate is pulled toward the tour
 * average, so someone with one match does not arrive with an extreme number.
 * Their rate on a given surface is then pulled toward their own overall rate,
 * re-based to that surface, so a clay estimate built on two matches leans on
 * everything else they have played rather than standing alone.
 *
 * Older matches count for less, on the same exponential decay the rest of the
 * engine uses.
 */

import { daysBetween, decayWeight } from '@/lib/engine/math';
import type { HistoryMatch } from '@/lib/engine/history';
import { clampServeRate, parseTennisFormat } from '@/lib/engine/sports/tennis-markov';

export interface ServeSample {
  player: string;
  opponent: string;
  date: Date;
  surface: string;
  servePoints: number;
  servePointsWon: number;
  returnPoints: number;
  returnPointsWon: number;
}

export interface ServeParams {
  xi: number;
  maxAgeDays: number;
  /** Pseudo serve points pulling a player toward the tour average. */
  shrinkPoints: number;
  /** Pseudo points pulling a surface rate toward the player's overall rate. */
  surfaceShrinkPoints: number;
  /** Below this weighted point count a player has no usable estimate. */
  minPoints: number;
  /** Where the tour average sits before any matches are seen. */
  tourPrior: number;
  /** Pseudo points behind that prior, so a thin tour cannot define itself. */
  tourPriorPoints: number;
}

export const DEFAULT_SERVE_PARAMS: ServeParams = {
  xi: 0.0025,
  maxAgeDays: 900,
  shrinkPoints: 400,
  surfaceShrinkPoints: 700,
  minPoints: 250,
  tourPrior: 0.62,
  tourPriorPoints: 2_000,
};

/** The pooled bucket, covering every surface at once. */
const ALL = '';

export interface ServeState {
  /** Surface (or the pooled bucket) to the tour's average serve-point win rate. */
  tour: Record<string, number>;
  serve: Record<string, Record<string, number>>;
  ret: Record<string, Record<string, number>>;
  /** Weighted serve points seen per player, which is how much evidence there is. */
  points: Record<string, number>;
  samples: number;
  fittedAt: string;
}

interface Tally {
  won: number;
  total: number;
}

function add(map: Map<string, Tally>, key: string, won: number, total: number): void {
  const entry = map.get(key) ?? { won: 0, total: 0 };
  entry.won += won;
  entry.total += total;
  map.set(key, entry);
}

/** Build samples from loaded history. Both players' stat blobs are already in memory. */
export function serveSamplesFrom(history: HistoryMatch[]): ServeSample[] {
  const out: ServeSample[] = [];
  for (const match of history) {
    const home = match.stats.home;
    const away = match.stats.away;
    if (!home || !away) continue;
    const hPts = home.servePoints;
    const hWon = home.servePointsWon;
    const aPts = away.servePoints;
    const aWon = away.servePointsWon;
    if (typeof hPts !== 'number' || typeof hWon !== 'number' || typeof aPts !== 'number' || typeof aWon !== 'number') continue;
    // A retirement leaves a part-played match; too few points to say anything.
    if (hPts < 30 || aPts < 30) continue;
    const surface = parseTennisFormat(match.format).surface;
    out.push({
      player: match.home,
      opponent: match.away,
      date: match.date,
      surface,
      servePoints: hPts,
      servePointsWon: hWon,
      returnPoints: aPts,
      returnPointsWon: aPts - aWon,
    });
    out.push({
      player: match.away,
      opponent: match.home,
      date: match.date,
      surface,
      servePoints: aPts,
      servePointsWon: aWon,
      returnPoints: hPts,
      returnPointsWon: hPts - hWon,
    });
  }
  return out;
}

export function fitServeReturn(samples: ServeSample[], asOf: Date, params: ServeParams = DEFAULT_SERVE_PARAMS): ServeState {
  const tourServe = new Map<string, Tally>();
  const playerServe = new Map<string, Tally>();
  const playerReturn = new Map<string, Tally>();
  const surfaces = new Set<string>([ALL]);

  for (const sample of samples) {
    const age = daysBetween(sample.date, asOf);
    if (age > params.maxAgeDays || age < 0) continue;
    const w = decayWeight(age, params.xi);
    surfaces.add(sample.surface);
    add(tourServe, ALL, w * sample.servePointsWon, w * sample.servePoints);
    add(tourServe, sample.surface, w * sample.servePointsWon, w * sample.servePoints);
    add(playerServe, `${sample.player}|${ALL}`, w * sample.servePointsWon, w * sample.servePoints);
    add(playerServe, `${sample.player}|${sample.surface}`, w * sample.servePointsWon, w * sample.servePoints);
    add(playerReturn, `${sample.player}|${ALL}`, w * sample.returnPointsWon, w * sample.returnPoints);
    add(playerReturn, `${sample.player}|${sample.surface}`, w * sample.returnPointsWon, w * sample.returnPoints);
  }

  const tour: Record<string, number> = {};
  const pooled = tourServe.get(ALL) ?? { won: 0, total: 0 };
  const pooledRate = (pooled.won + params.tourPrior * params.tourPriorPoints) / (pooled.total + params.tourPriorPoints);
  for (const surface of surfaces) {
    const entry = tourServe.get(surface) ?? { won: 0, total: 0 };
    tour[surface] = (entry.won + pooledRate * params.tourPriorPoints) / (entry.total + params.tourPriorPoints);
  }
  tour[ALL] = pooledRate;

  const serve: Record<string, Record<string, number>> = {};
  const ret: Record<string, Record<string, number>> = {};
  const points: Record<string, number> = {};
  const players = new Set<string>();
  for (const key of playerServe.keys()) players.add(key.split('|')[0]);

  for (const player of players) {
    const ownServe = playerServe.get(`${player}|${ALL}`) ?? { won: 0, total: 0 };
    const ownReturn = playerReturn.get(`${player}|${ALL}`) ?? { won: 0, total: 0 };
    points[player] = ownServe.total;
    const overallServe = (ownServe.won + params.shrinkPoints * tour[ALL]) / (ownServe.total + params.shrinkPoints);
    const overallReturn = (ownReturn.won + params.shrinkPoints * (1 - tour[ALL])) / (ownReturn.total + params.shrinkPoints);
    serve[player] = { [ALL]: overallServe };
    ret[player] = { [ALL]: overallReturn };
    for (const surface of surfaces) {
      if (surface === ALL) continue;
      // The prior is this player's own level, re-based to how the surface plays.
      const scale = tour[ALL] > 0 ? tour[surface] / tour[ALL] : 1;
      const sServe = playerServe.get(`${player}|${surface}`) ?? { won: 0, total: 0 };
      const sReturn = playerReturn.get(`${player}|${surface}`) ?? { won: 0, total: 0 };
      const priorServe = overallServe * scale;
      const returnScale = 1 - tour[ALL] > 0 ? (1 - tour[surface]) / (1 - tour[ALL]) : 1;
      const priorReturn = overallReturn * returnScale;
      serve[player][surface] = (sServe.won + params.surfaceShrinkPoints * priorServe) / (sServe.total + params.surfaceShrinkPoints);
      ret[player][surface] = (sReturn.won + params.surfaceShrinkPoints * priorReturn) / (sReturn.total + params.surfaceShrinkPoints);
    }
  }

  return { tour, serve, ret, points, samples: samples.length, fittedAt: asOf.toISOString() };
}

export interface MatchServeProbs {
  home: number;
  away: number;
  evidence: { home: number; away: number };
}

/**
 * Combine two players into the serve-point win rate each will manage.
 *
 * A player's serve strength above the tour average, less the opponent's
 * return strength above average, added back to the average. Two exactly
 * average players return exactly the average, which is the sanity check.
 * Returns null when either player is too thinly sampled to judge.
 */
export function matchServeProbs(state: ServeState, home: string, away: string, surface: string, params: ServeParams = DEFAULT_SERVE_PARAMS): MatchServeProbs | null {
  const homePoints = state.points[home] ?? 0;
  const awayPoints = state.points[away] ?? 0;
  if (homePoints < params.minPoints || awayPoints < params.minPoints) return null;
  const key = state.tour[surface] !== undefined ? surface : ALL;
  const tourServe = state.tour[key];
  const tourReturn = 1 - tourServe;
  const serveHome = state.serve[home]?.[key] ?? state.serve[home]?.[ALL];
  const serveAway = state.serve[away]?.[key] ?? state.serve[away]?.[ALL];
  const returnHome = state.ret[home]?.[key] ?? state.ret[home]?.[ALL];
  const returnAway = state.ret[away]?.[key] ?? state.ret[away]?.[ALL];
  if (serveHome === undefined || serveAway === undefined || returnHome === undefined || returnAway === undefined) return null;
  return {
    home: clampServeRate(serveHome - returnAway + tourReturn),
    away: clampServeRate(serveAway - returnHome + tourReturn),
    evidence: { home: homePoints, away: awayPoints },
  };
}
