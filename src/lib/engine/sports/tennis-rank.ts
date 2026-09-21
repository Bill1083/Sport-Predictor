/**
 * The ranking model.
 *
 * Two players who have never met, with no matches between them on record,
 * are not a coin flip: the tour already ranks them. This turns that ranking
 * gap into a win probability.
 *
 * The gap is measured in multiples rather than places. Number one against
 * number ten is a factor of ten, the same as thirty against three hundred,
 * and both are far bigger gaps than three hundred against three hundred and
 * ten. Taking natural logs is what encodes that.
 */

import { clamp, sigmoid } from '@/lib/engine/math';
import type { ProbMap } from '@/lib/types';

export interface RankParams {
  /** Log-odds added per natural-log unit of ranking gap. */
  beta: number;
  /** The rank an unranked player is treated as holding. */
  unrankedRank: number;
  /** How far a one-sided ranking is pulled back toward even, 0..1. */
  unrankedShrink: number;
  /** Probabilities are held inside [floor, 1 - floor]. */
  floor: number;
}

export const DEFAULT_RANK_PARAMS: RankParams = { beta: 0.4, unrankedRank: 500, unrankedShrink: 0.6, floor: 0.05 };

export interface RankState {
  beta: number;
  matches: number;
  logLoss: number;
  fittedAt: string;
}

/**
 * Win probability from the two rankings. Returns null when neither player is
 * ranked, so the model stays silent rather than contributing a flat guess the
 * ensemble would have to carry.
 */
export function rankProbs(rankHome: number | null, rankAway: number | null, params: RankParams = DEFAULT_RANK_PARAMS): ProbMap | null {
  if (rankHome === null && rankAway === null) return null;
  const home = Math.max(1, rankHome ?? params.unrankedRank);
  const away = Math.max(1, rankAway ?? params.unrankedRank);
  const gap = Math.log(away) - Math.log(home);
  let p = sigmoid(params.beta * gap);
  // Half the pairing is a guess, so only trust half the edge.
  if (rankHome === null || rankAway === null) p = 0.5 + params.unrankedShrink * (p - 0.5);
  p = clamp(p, params.floor, 1 - params.floor);
  return { HOME: p, AWAY: 1 - p };
}

export interface RankSample {
  rankHome: number;
  rankAway: number;
  homeWon: boolean;
}

/**
 * Fit beta by penalised maximum likelihood. One parameter, and the likelihood
 * is convex, so Newton's method converges in a handful of steps and needs no
 * library. Thin samples keep the prior rather than chasing noise.
 */
export function fitRankBeta(samples: RankSample[], params: RankParams = DEFAULT_RANK_PARAMS, l2 = 2, minSamples = 200): RankState {
  const usable = samples.filter((s) => s.rankHome > 0 && s.rankAway > 0);
  const prior = params.beta;
  if (usable.length < minSamples) {
    return { beta: prior, matches: usable.length, logLoss: Number.NaN, fittedAt: new Date().toISOString() };
  }
  const xs = usable.map((s) => Math.log(s.rankAway) - Math.log(s.rankHome));
  const ys = usable.map((s) => (s.homeWon ? 1 : 0));
  let beta = prior;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    let gradient = l2 * (beta - prior);
    let hessian = l2;
    for (let i = 0; i < xs.length; i += 1) {
      const p = sigmoid(beta * xs[i]);
      gradient += (p - ys[i]) * xs[i];
      hessian += p * (1 - p) * xs[i] * xs[i];
    }
    if (hessian <= 0) break;
    const step = gradient / hessian;
    beta -= step;
    beta = clamp(beta, 0.05, 1.5);
    if (Math.abs(step) < 1e-9) break;
  }
  let loss = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const p = clamp(sigmoid(beta * xs[i]), 1e-9, 1 - 1e-9);
    loss += -(ys[i] * Math.log(p) + (1 - ys[i]) * Math.log(1 - p));
  }
  return { beta, matches: usable.length, logLoss: loss / xs.length, fittedAt: new Date().toISOString() };
}

export interface SeedOptions {
  beta: number;
  initialRating: number;
  /** The rank that maps to the starting rating; everyone else is placed around it. */
  refRank: number;
  seedScale: number;
}

/**
 * A starting Elo rating implied by a ranking.
 *
 * Elo's expectation is a logistic in rating gap over 400 points of base ten,
 * and the ranking model is a logistic in log-rank gap. Setting the two equal
 * gives 400 * beta / ln(10) rating points per log-rank unit, so a player
 * seeded this way and a player judged by the ranking model agree exactly.
 */
export function ratingFromRank(rank: number, options: SeedOptions): number {
  const perLogUnit = (400 * options.beta) / Math.LN10;
  const gap = Math.log(Math.max(1, options.refRank)) - Math.log(Math.max(1, rank));
  return options.initialRating + options.seedScale * perLogUnit * gap;
}
