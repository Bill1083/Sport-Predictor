import { fail, guard, ok } from '@/lib/api';
import { prisma, withDatabase } from '@/lib/prisma';
import { EVENT_INCLUDE, serializeEvent, serializePrediction } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/** GET /api/events/:id - one event with every prediction version. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return guard(async () => {
    const row = await withDatabase(() =>
      prisma.event.findUnique({
        where: { id: params.id },
        include: { ...EVENT_INCLUDE, predictions: { orderBy: [{ modelKey: 'asc' }, { version: 'desc' }] } },
      }),
    );
    if (!row.ok || !row.data) return fail('No such event.', 404);
    return ok({ event: serializeEvent(row.data), predictions: row.data.predictions.map(serializePrediction) });
  }, 'GET /api/events/[id]');
}
