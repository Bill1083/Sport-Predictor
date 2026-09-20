/**
 * Enabled sports and the selected-sport cookie that every page follows.
 */

import type { Sport } from '@prisma/client';
import { cookies } from 'next/headers';

import { prisma, withDatabase } from '@/lib/prisma';
import { sportDefinition, SPORTS } from '@/lib/sports/registry';
import type { SportOption } from '@/components/sport-switcher';

export const SPORT_COOKIE = 'scoresage_sport';
export const ALL_SPORTS = 'all';

/** Sports the user has switched on, in display order. */
export async function listEnabledSports(): Promise<Sport[]> {
  const result = await withDatabase(() =>
    prisma.sport.findMany({ where: { enabled: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
  );
  return result.ok ? result.data : [];
}

/** Every known sport with its stored row (or a default one when never saved). */
export async function listAllSports(): Promise<Sport[]> {
  const stored = await withDatabase(() => prisma.sport.findMany());
  const byKey = new Map((stored.ok ? stored.data : []).map((row) => [row.key, row]));
  const now = new Date();
  return SPORTS.map((definition, index) => {
    return (
      byKey.get(definition.key) ?? {
        key: definition.key,
        name: definition.name,
        enabled: false,
        mode: 'HYBRID',
        sortOrder: index,
        createdAt: now,
        updatedAt: now,
      }
    );
  });
}

/**
 * The sport the dashboard is currently showing. `null` means "all sports".
 * Falls back to the first sport when the cookie points at one that is no
 * longer enabled. A single enabled sport never needs the aggregate view.
 */
export async function resolveSportSelection(
  sports?: Sport[],
): Promise<{ sports: Sport[]; selected: Sport | null; selectedKey: string }> {
  const list = sports ?? (await listEnabledSports());
  const raw = cookies().get(SPORT_COOKIE)?.value;
  if (!raw || raw === ALL_SPORTS) {
    if (list.length === 1 && !raw) return { sports: list, selected: list[0], selectedKey: list[0].key };
    return { sports: list, selected: null, selectedKey: ALL_SPORTS };
  }
  const match = list.find((sport) => sport.key === raw);
  if (match) return { sports: list, selected: match, selectedKey: match.key };
  return list.length > 0
    ? { sports: list, selected: list[0], selectedKey: list[0].key }
    : { sports: list, selected: null, selectedKey: ALL_SPORTS };
}

/** What the header switcher needs, with the followed-competition count. */
export async function sportOptions(sports: Sport[]): Promise<SportOption[]> {
  if (sports.length === 0) return [];
  const counts = await withDatabase(() =>
    prisma.competition.groupBy({
      by: ['sportKey'],
      where: { followed: true, sportKey: { in: sports.map((s) => s.key) } },
      _count: { _all: true },
    }),
  );
  const followed = new Map((counts.ok ? counts.data : []).map((row) => [row.sportKey, row._count._all]));
  return sports.map((sport) => ({
    key: sport.key,
    name: sport.name,
    icon: sportDefinition(sport.key)?.icon ?? 'football',
    mode: sport.mode,
    followed: followed.get(sport.key) ?? 0,
  }));
}

/** Prisma `where` fragment for the selected sport (empty on "all"). */
export function sportScope(selected: Sport | null): { sportKey?: string } {
  return selected ? { sportKey: selected.key } : {};
}
