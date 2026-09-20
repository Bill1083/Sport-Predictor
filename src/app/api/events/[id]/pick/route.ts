import { z } from 'zod';

import { fail, guard, ok, readJson } from '@/lib/api';
import { prisma, withDatabase } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  outcome: z.enum(['HOME', 'DRAW', 'AWAY']).nullable(),
  predictedScore: z.string().max(12).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

/** POST /api/events/:id/pick - record (or clear, with outcome null) your own call before kickoff. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return guard(async () => {
    const parsed = await readJson(request, bodySchema, 8 * 1024);
    if (!parsed.ok) return parsed.response;
    const event = await withDatabase(() => prisma.event.findUnique({ where: { id: params.id } }));
    if (!event.ok || !event.data) return fail('No such event.', 404);
    if (event.data.status !== 'SCHEDULED' || event.data.startsAt.getTime() <= Date.now()) return fail('Picks close at kickoff.', 409);
    const { outcome, predictedScore, note } = parsed.data;
    if (!outcome) {
      await withDatabase(() => prisma.userPick.deleteMany({ where: { eventId: params.id } }));
      return ok({ pick: null });
    }
    const pick = await prisma.userPick.upsert({
      where: { eventId: params.id },
      create: { eventId: params.id, outcome, predictedScore: predictedScore ?? null, note: note ?? null },
      update: { outcome, predictedScore: predictedScore ?? null, note: note ?? null },
    });
    return ok({ pick: { outcome: pick.outcome, predictedScore: pick.predictedScore, note: pick.note } });
  }, 'POST /api/events/[id]/pick');
}
