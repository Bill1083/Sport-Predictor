import { fail, guard, ok } from '@/lib/api';
import { prisma, withDatabase } from '@/lib/prisma';
import { serializeRun } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

/** GET /api/runs/:id - one run with its log. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  return guard(async () => {
    const row = await withDatabase(() => prisma.modelRun.findUnique({ where: { id: params.id } }));
    if (!row.ok || !row.data) return fail('No such run.', 404);
    return ok({ run: serializeRun(row.data), log: row.data.log });
  }, 'GET /api/runs/[id]');
}
