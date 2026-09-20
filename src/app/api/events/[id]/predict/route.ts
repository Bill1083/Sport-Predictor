import { fail, guard, ok } from '@/lib/api';
import { predictSport } from '@/lib/engine/predict';
import { prisma, withDatabase } from '@/lib/prisma';
import { isSportKey } from '@/lib/sports/registry';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** POST /api/events/:id/predict - a fresh prediction version for one event, now. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  return guard(async () => {
    const event = await withDatabase(() => prisma.event.findUnique({ where: { id: params.id } }));
    if (!event.ok || !event.data) return fail('No such event.', 404);
    if (!isSportKey(event.data.sportKey)) return fail('Unknown sport.', 400);
    if (event.data.status === 'FINISHED' || event.data.status === 'CANCELLED') return fail('That event is over.', 409);
    const summary = await predictSport(event.data.sportKey, { eventIds: [event.data.id], force: true });
    return ok({ predicted: summary.predicted });
  }, 'POST /api/events/[id]/predict');
}
