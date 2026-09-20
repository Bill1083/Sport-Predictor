/**
 * The feature vector the feature model learns from, and the plain-language
 * factors the match page shows. Every feature is a difference or a
 * probability so the same model transfers across leagues.
 */

import { eloRating, type EloState } from '@/lib/engine/elo';
import { formOf, recentFor, type HistoryMatch } from '@/lib/engine/history';
import type { Factor, ProbMap } from '@/lib/types';

export const FEATURE_KEYS = [
  'eloDiff',
  'dcHome',
  'dcAway',
  'form5Diff',
  'gd5Diff',
  'homeVenueForm',
  'awayVenueForm',
  'restDiff',
  'h2hEdge',
  'posDiff',
  'absenceDiff',
  'experience',
] as const;

export interface FeatureInput {
  history: HistoryMatch[];
  home: string;
  away: string;
  kickoff: Date;
  elo: EloState;
  /** Score-model probabilities (Dixon-Coles or margin), if any. */
  dcProbs: ProbMap | null;
  /** Table positions before the match, 1-based; null when unknown. */
  positions: { home: number | null; away: number | null; teams: number };
  /** Players ruled out on each side. */
  absences: { home: number; away: number };
}

function restDays(history: HistoryMatch[], team: string, kickoff: Date): number {
  const last = recentFor(history, team, kickoff, 1)[0];
  if (!last) return 7;
  return Math.min(14, Math.max(1, (kickoff.getTime() - last.date.getTime()) / 86_400_000));
}

function h2h(history: HistoryMatch[], home: string, away: string, kickoff: Date, n = 6): number {
  let edge = 0;
  let count = 0;
  for (let i = history.length - 1; i >= 0 && count < n; i -= 1) {
    const m = history[i];
    if (m.date >= kickoff) continue;
    const pair = (m.home === home && m.away === away) || (m.home === away && m.away === home);
    if (!pair) continue;
    count += 1;
    const homeWon = (m.home === home && m.homeScore > m.awayScore) || (m.away === home && m.awayScore > m.homeScore);
    const awayWon = (m.home === away && m.homeScore > m.awayScore) || (m.away === away && m.awayScore > m.homeScore);
    edge += homeWon ? 1 : awayWon ? -1 : 0;
  }
  return count > 0 ? edge / count : 0;
}

export function buildFeatures(input: FeatureInput): Record<string, number> {
  const { history, home, away, kickoff } = input;
  const homeRecent = recentFor(history, home, kickoff, 5);
  const awayRecent = recentFor(history, away, kickoff, 5);
  const homeForm = formOf(homeRecent, home);
  const awayForm = formOf(awayRecent, away);
  const homeVenue = formOf(recentFor(history, home, kickoff, 5, 'home'), home);
  const awayVenue = formOf(recentFor(history, away, kickoff, 5, 'away'), away);
  const posDiff =
    input.positions.home !== null && input.positions.away !== null && input.positions.teams > 1
      ? (input.positions.away - input.positions.home) / (input.positions.teams - 1)
      : 0;
  return {
    eloDiff: (eloRating(input.elo, home) - eloRating(input.elo, away)) / 400,
    dcHome: input.dcProbs?.HOME ?? 0.45,
    dcAway: input.dcProbs?.AWAY ?? 0.29,
    form5Diff: homeForm.ppg - awayForm.ppg,
    gd5Diff: homeForm.gdpg - awayForm.gdpg,
    homeVenueForm: homeVenue.ppg,
    awayVenueForm: awayVenue.ppg,
    restDiff: restDays(history, home, kickoff) - restDays(history, away, kickoff),
    h2hEdge: h2h(history, home, away, kickoff),
    posDiff,
    absenceDiff: input.absences.away - input.absences.home,
    experience: Math.min(homeForm.n, awayForm.n) / 5,
  };
}

/**
 * Plain-language factors from the features, in probability points on the
 * home side. Heuristic sizes, used when the feature model is not trained;
 * once it is, its contributions replace these.
 */
export function heuristicFactors(features: Record<string, number>, eloHomeAdvantagePoints: number): Factor[] {
  const factors: Factor[] = [];
  const push = (key: string, label: string, effect: number, note?: string) => {
    if (Math.abs(effect) >= 0.3) factors.push({ key, label, effect: Math.round(effect * 10) / 10, note, source: 'model' });
  };
  push('rating', 'Rating gap', features.eloDiff * 400 * 0.09, `${Math.round(features.eloDiff * 400)} Elo points`);
  push('home', 'Home advantage', eloHomeAdvantagePoints * 0.09);
  push('form', 'Recent form', features.form5Diff * 2.5, `${features.form5Diff >= 0 ? '+' : ''}${features.form5Diff.toFixed(2)} points per game over five`);
  push('venue', 'Home / away record', (features.homeVenueForm - features.awayVenueForm) * 1.2);
  push('rest', 'Rest', features.restDiff * 0.4, `${features.restDiff >= 0 ? '+' : ''}${features.restDiff.toFixed(0)} days`);
  push('h2h', 'Head to head', features.h2hEdge * 2);
  push('absences', 'Absences', features.absenceDiff * 1.5, `${features.absenceDiff >= 0 ? '+' : ''}${features.absenceDiff} more out on the other side`);
  push('table', 'Table position', features.posDiff * 3);
  return factors.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 7);
}

/** Feature-model contributions (home vs away log-odds) turned into probability points. */
export function contributionsToFactors(contributions: Record<string, number>, homeProb: number): Factor[] {
  const labels: Record<string, string> = {
    eloDiff: 'Rating gap',
    dcHome: 'Expected goals (home)',
    dcAway: 'Expected goals (away)',
    form5Diff: 'Recent form',
    gd5Diff: 'Goal difference form',
    homeVenueForm: 'Home record',
    awayVenueForm: 'Away record',
    restDiff: 'Rest',
    h2hEdge: 'Head to head',
    posDiff: 'Table position',
    absenceDiff: 'Absences',
    experience: 'Sample size',
  };
  // d p / d logit = p (1 - p); scale log-odds contributions into points.
  const slope = homeProb * (1 - homeProb) * 100;
  return Object.entries(contributions)
    .map(([key, value]) => ({ key, label: labels[key] ?? key, effect: Math.round(value * slope * 10) / 10, source: 'model' as const }))
    .filter((f) => Math.abs(f.effect) >= 0.3)
    .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
    .slice(0, 7);
}
