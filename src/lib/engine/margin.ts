/**
 * Margin model for points-based sports (rugby, basketball, gridiron): the
 * expected margin is linear in the rating gap plus a home edge, and the
 * actual margin is normal around it. Draw probability is the mass in a
 * narrow band around zero. Fitted parameters: the points-per-Elo slope,
 * the home edge in points, and the margin spread.
 */

import { normalCdf } from '@/lib/engine/math';
import type { HistoryMatch } from '@/lib/engine/history';
import { eloRating, type EloState } from '@/lib/engine/elo';
import type { ProbMap, ScoreForecast } from '@/lib/types';

export interface MarginState {
  /** Points of expected margin per Elo point of gap. */
  slope: number;
  homeEdge: number;
  sigma: number;
  avgTotal: number;
  matches: number;
  fittedAt: string;
}

export function fitMargin(history: HistoryMatch[], elo: EloState, asOf: Date, priors: { homeAdvantage: number; avgScore: number; scoreSd: number }): MarginState {
  const rows = history.filter((m) => m.date < asOf);
  if (rows.length < 20) {
    return { slope: 0.04, homeEdge: priors.homeAdvantage, sigma: priors.scoreSd, avgTotal: priors.avgScore * 2, matches: rows.length, fittedAt: new Date().toISOString() };
  }
  // Least squares of margin on the (current) rating gap. Using end-of-history
  // ratings is a small leak in-sample; the walk-forward pass measures honestly.
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let total = 0;
  for (const m of rows) {
    const x = eloRating(elo, m.home) - eloRating(elo, m.away);
    const y = m.homeScore - m.awayScore;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
    total += m.homeScore + m.awayScore;
  }
  const n = rows.length;
  const denom = n * sxx - sx * sx;
  const slope = denom > 0 ? Math.max(0.005, (n * sxy - sx * sy) / denom) : 0.04;
  const homeEdge = (sy - slope * sx) / n;
  let ss = 0;
  for (const m of rows) {
    const x = eloRating(elo, m.home) - eloRating(elo, m.away);
    const residual = m.homeScore - m.awayScore - (homeEdge + slope * x);
    ss += residual * residual;
  }
  return { slope, homeEdge, sigma: Math.max(1, Math.sqrt(ss / Math.max(1, n - 2))), avgTotal: total / n, matches: n, fittedAt: new Date().toISOString() };
}

export function marginPredict(state: MarginState, elo: EloState, home: string, away: string, hasDraws: boolean): { probs: ProbMap; score: ScoreForecast } {
  const gap = eloRating(elo, home) - eloRating(elo, away);
  const mu = state.homeEdge + state.slope * gap;
  // A draw is a margin within half a point of zero.
  const pAwayOrDraw = normalCdf(0.5, mu, state.sigma);
  const pAway = hasDraws ? normalCdf(-0.5, mu, state.sigma) : normalCdf(0, mu, state.sigma);
  const pDraw = hasDraws ? Math.max(0, pAwayOrDraw - pAway) : 0;
  const pHome = 1 - pAway - pDraw;
  const homeExp = (state.avgTotal + mu) / 2;
  const awayExp = (state.avgTotal - mu) / 2;
  const probs: ProbMap = hasDraws ? { HOME: pHome, DRAW: pDraw, AWAY: pAway } : { HOME: pHome, AWAY: pAway };
  return {
    probs,
    score: {
      expected: { home: Math.round(homeExp * 10) / 10, away: Math.round(awayExp * 10) / 10 },
      mostLikely: { home: Math.round(homeExp), away: Math.round(awayExp), p: 0 },
      top: [],
      lines: { margin: Math.round(mu * 10) / 10, sigma: Math.round(state.sigma * 10) / 10 },
    },
  };
}
