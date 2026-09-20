import { z } from 'zod';

import { fail, guard, ok, readJson } from '@/lib/api';
import { runJob } from '@/lib/jobs/runner';
import { prisma, withDatabase } from '@/lib/prisma';
import { serializeCompetition, type CompetitionDto } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export interface CompetitionsResponse {
  competitions: (CompetitionDto & { events: number })[];
}

/** GET /api/competitions?sport=football&followed=true */
export async function GET(request: Request) {
  return guard(async () => {
    const url = new URL(request.url);
    const sportKey = url.searchParams.get('sport');
    const followedOnly = url.searchParams.get('followed') === 'true';
    const rows = await withDatabase(() =>
      prisma.competition.findMany({
        where: { ...(sportKey ? { sportKey } : {}), ...(followedOnly ? { followed: true } : {}) },
        orderBy: [{ followed: 'desc' }, { tier: 'asc' }, { country: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { events: true } } },
      }),
    );
    if (!rows.ok) return fail('The database could not be reached.', 503);
    const response: CompetitionsResponse = {
      competitions: rows.data.map((row) => ({ ...serializeCompetition(row), events: row._count.events })),
    };
    return ok(response);
  }, 'GET /api/competitions');
}

const patchSchema = z.object({
  id: z.string().min(1),
  followed: z.boolean().optional(),
  currentSeason: z.string().max(12).optional(),
});

/**
 * PATCH /api/competitions - follow or unfollow. Following starts a fixture
 * sync in the background so the Today page fills within seconds.
 */
export async function PATCH(request: Request) {
  return guard(async () => {
    const parsed = await readJson(request, patchSchema, 8 * 1024);
    if (!parsed.ok) return parsed.response;
    const { id, followed, currentSeason } = parsed.data;
    const existing = await withDatabase(() => prisma.competition.findUnique({ where: { id } }));
    if (!existing.ok || !existing.data) return fail('No such competition.', 404);

    const updated = await prisma.competition.update({
      where: { id },
      data: { ...(followed !== undefined ? { followed } : {}), ...(currentSeason ? { currentSeason } : {}) },
    });
    if (followed) {
      void runJob('sync:fixtures', { sportKey: updated.sportKey, competitionId: id }, 'manual').then(() =>
        runJob('sync:catalogue', { sportKey: updated.sportKey }, 'manual'),
      );
    }
    return ok({ competition: serializeCompetition(updated) });
  }, 'PATCH /api/competitions');
}
