import { fail, guard, ok } from '@/lib/api';
import { prisma, withDatabase } from '@/lib/prisma';
import { competitionTable } from '@/lib/standings';

export const dynamic = 'force-dynamic';

/** GET /api/standings/:competitionId?season= - the table computed from results. */
export async function GET(request: Request, { params }: { params: { competitionId: string } }) {
  return guard(async () => {
    const competition = await withDatabase(() => prisma.competition.findUnique({ where: { id: params.competitionId } }));
    if (!competition.ok || !competition.data) return fail('No such competition.', 404);
    const season = new URL(request.url).searchParams.get('season') ?? competition.data.currentSeason ?? '';
    return ok({ season, table: await competitionTable(competition.data.id, season) });
  }, 'GET /api/standings/[competitionId]');
}
