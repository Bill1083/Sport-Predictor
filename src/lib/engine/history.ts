/**
 * The finished-match history the models learn from, loaded once per job and
 * shared. Everything is keyed by team id and ordered by date.
 */

import { prisma, withDatabase } from '@/lib/prisma';
import { parseJson } from '@/lib/prisma';
import type { SportKey } from '@/lib/sports/registry';
import { parseResult } from '@/lib/types';

export interface HistoryMatch {
  id: string;
  competitionId: string;
  season: string;
  date: Date;
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  stats: { home: Record<string, number> | null; away: Record<string, number> | null };
}

export async function loadSportHistory(sportKey: SportKey, before?: Date, competitionId?: string): Promise<HistoryMatch[]> {
  const rows = await withDatabase(() =>
    prisma.event.findMany({
      where: {
        sportKey,
        status: 'FINISHED',
        homeTeamId: { not: null },
        awayTeamId: { not: null },
        ...(before ? { startsAt: { lt: before } } : {}),
        ...(competitionId ? { competitionId } : {}),
      },
      select: {
        id: true,
        competitionId: true,
        season: true,
        startsAt: true,
        homeTeamId: true,
        awayTeamId: true,
        resultJson: true,
        stats: { select: { teamId: true, statsJson: true } },
      },
      orderBy: { startsAt: 'asc' },
    }),
  );
  if (!rows.ok) return [];
  const out: HistoryMatch[] = [];
  for (const row of rows.data) {
    const result = parseResult(row.resultJson);
    if (typeof result.homeScore !== 'number' || typeof result.awayScore !== 'number') continue;
    const homeStats = row.stats.find((s) => s.teamId === row.homeTeamId);
    const awayStats = row.stats.find((s) => s.teamId === row.awayTeamId);
    out.push({
      id: row.id,
      competitionId: row.competitionId,
      season: row.season,
      date: row.startsAt,
      home: row.homeTeamId as string,
      away: row.awayTeamId as string,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      stats: {
        home: homeStats ? parseJson<Record<string, number>>(homeStats.statsJson, {}) : null,
        away: awayStats ? parseJson<Record<string, number>>(awayStats.statsJson, {}) : null,
      },
    });
  }
  return out;
}

/** Outcome label of a finished match from the home side's view. */
export function outcomeOf(match: Pick<HistoryMatch, 'homeScore' | 'awayScore'>): 'HOME' | 'DRAW' | 'AWAY' {
  if (match.homeScore > match.awayScore) return 'HOME';
  if (match.homeScore < match.awayScore) return 'AWAY';
  return 'DRAW';
}

/** Recent matches of a team before `date`, most recent first. */
export function recentFor(history: HistoryMatch[], team: string, date: Date, n: number, venue?: 'home' | 'away'): HistoryMatch[] {
  const out: HistoryMatch[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < n; i -= 1) {
    const m = history[i];
    if (m.date >= date) continue;
    if (venue === 'home' ? m.home !== team : venue === 'away' ? m.away !== team : m.home !== team && m.away !== team) continue;
    out.push(m);
  }
  return out;
}

/** Points per game and goal difference per game over a team's recent matches. */
export function formOf(matches: HistoryMatch[], team: string): { ppg: number; gdpg: number; n: number } {
  if (matches.length === 0) return { ppg: 1.3, gdpg: 0, n: 0 };
  let points = 0;
  let gd = 0;
  for (const m of matches) {
    const isHome = m.home === team;
    const mine = isHome ? m.homeScore : m.awayScore;
    const theirs = isHome ? m.awayScore : m.homeScore;
    points += mine > theirs ? 3 : mine === theirs ? 1 : 0;
    gd += mine - theirs;
  }
  return { ppg: points / matches.length, gdpg: gd / matches.length, n: matches.length };
}

/** League outcome frequencies over a set of matches, with a prior for small samples. */
export function outcomeFrequencies(matches: HistoryMatch[], hasDraws: boolean): Record<string, number> {
  const prior: Record<string, number> = hasDraws ? { HOME: 0.45, DRAW: 0.26, AWAY: 0.29 } : { HOME: 0.57, AWAY: 0.43 };
  const weight = 40;
  const counts: Record<string, number> = { HOME: 0, DRAW: 0, AWAY: 0 };
  for (const m of matches) counts[outcomeOf(m)] += 1;
  const n = matches.length;
  const out: Record<string, number> = {};
  for (const key of Object.keys(prior)) out[key] = (counts[key] + weight * (prior[key] ?? 0)) / (n + weight);
  if (!hasDraws) {
    // Fold any draws (rare or impossible) into the sides evenly.
    const total = out.HOME + out.AWAY;
    out.HOME /= total;
    out.AWAY /= total;
  }
  return out;
}
