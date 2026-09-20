import { z } from 'zod';

import { fail, guard, ok, readJson } from '@/lib/api';
import { ensureSyncJobs, runJob } from '@/lib/jobs/runner';
import { prisma, withDatabase } from '@/lib/prisma';
import { serializeSport, type SportDto } from '@/lib/serialize';
import { isSportKey, SPORTS } from '@/lib/sports/registry';
import { listAllSports } from '@/lib/sports/selection';

export const dynamic = 'force-dynamic';

export interface SportsResponse {
  sports: (SportDto & { followed: number; competitions: number })[];
}

/** GET /api/sports - every known sport with its enabled state and counts. */
export async function GET() {
  return guard(async () => {
    const sports = await listAllSports();
    const counts = await withDatabase(() =>
      prisma.competition.groupBy({ by: ['sportKey', 'followed'], _count: { _all: true } }),
    );
    const followed = new Map<string, number>();
    const total = new Map<string, number>();
    for (const row of counts.ok ? counts.data : []) {
      total.set(row.sportKey, (total.get(row.sportKey) ?? 0) + row._count._all);
      if (row.followed) followed.set(row.sportKey, row._count._all);
    }
    const response: SportsResponse = {
      sports: sports.map((sport) => ({
        ...serializeSport(sport),
        followed: followed.get(sport.key) ?? 0,
        competitions: total.get(sport.key) ?? 0,
      })),
    };
    return ok(response);
  }, 'GET /api/sports');
}

const patchSchema = z.object({
  key: z.string().min(1).max(40),
  enabled: z.boolean().optional(),
  mode: z.enum(['ALGORITHM', 'AI', 'HYBRID']).optional(),
});

/**
 * PATCH /api/sports - switch a sport on or off, or change its prediction
 * mode. Enabling a sport seeds its recurring jobs and starts a catalogue
 * sync in the background so competitions appear within seconds.
 */
export async function PATCH(request: Request) {
  return guard(async () => {
    const parsed = await readJson(request, patchSchema, 8 * 1024);
    if (!parsed.ok) return parsed.response;
    const { key, enabled, mode } = parsed.data;
    if (!isSportKey(key)) return fail('Unknown sport.', 404);
    const definition = SPORTS.find((s) => s.key === key)!;

    const sport = await prisma.sport.upsert({
      where: { key },
      create: { key, name: definition.name, enabled: enabled ?? false, mode: mode ?? 'HYBRID', sortOrder: SPORTS.indexOf(definition) },
      update: { ...(enabled !== undefined ? { enabled } : {}), ...(mode !== undefined ? { mode } : {}) },
    });

    if (enabled) {
      await ensureSyncJobs();
      void runJob('sync:catalogue', { sportKey: key }, 'manual');
    }
    return ok({ sport: serializeSport(sport) });
  }, 'PATCH /api/sports');
}
