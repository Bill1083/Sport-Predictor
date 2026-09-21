/**
 * Published rankings, read once per prediction pass.
 *
 * Ranks are stored as a rating time series, so the current list is the newest
 * row per competitor. One query covers every event in the pass; the window
 * keeps the row count bounded as weekly lists accumulate.
 */

import { prisma, withDatabase } from '@/lib/prisma';
import type { SportKey } from '@/lib/sports/registry';

export interface RankIndex {
  rank: Map<string, number>;
  asOf: Map<string, Date>;
  /** The worst rank on the list, so an unranked player can be placed beyond it. */
  worst: number;
  count: number;
}

export const EMPTY_RANK_INDEX: RankIndex = { rank: new Map(), asOf: new Map(), worst: 0, count: 0 };

export async function loadRankIndex(sportKey: SportKey, lookbackDays = 120): Promise<RankIndex> {
  const rows = await withDatabase(() =>
    prisma.rating.findMany({
      where: { sportKey, model: 'RANK', asOf: { gte: new Date(Date.now() - lookbackDays * 86_400_000) } },
      orderBy: { asOf: 'desc' },
      select: { teamId: true, value: true, asOf: true },
    }),
  );
  if (!rows.ok) return { rank: new Map(), asOf: new Map(), worst: 0, count: 0 };
  const rank = new Map<string, number>();
  const asOf = new Map<string, Date>();
  let worst = 0;
  for (const row of rows.data) {
    // Newest first, so the first row seen for a competitor is their current rank.
    if (rank.has(row.teamId)) continue;
    rank.set(row.teamId, row.value);
    asOf.set(row.teamId, row.asOf);
    if (row.value > worst) worst = row.value;
  }
  return { rank, asOf, worst, count: rank.size };
}

export function rankOf(index: RankIndex | null, teamId: string): number | null {
  return index?.rank.get(teamId) ?? null;
}
