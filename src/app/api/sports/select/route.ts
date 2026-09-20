import { z } from 'zod';

import { fail, guard, ok, readJson } from '@/lib/api';
import { env } from '@/lib/env';
import { prisma, withDatabase } from '@/lib/prisma';
import { ALL_SPORTS, SPORT_COOKIE } from '@/lib/sports/selection';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ sportKey: z.string().min(1).max(40) });

/** POST /api/sports/select - choose the sport every page shows. */
export async function POST(request: Request) {
  return guard(async () => {
    const parsed = await readJson(request, bodySchema, 4 * 1024);
    if (!parsed.ok) return parsed.response;
    const { sportKey } = parsed.data;

    if (sportKey !== ALL_SPORTS) {
      const sport = await withDatabase(() => prisma.sport.findUnique({ where: { key: sportKey } }));
      if (!sport.ok || !sport.data || !sport.data.enabled) return fail('No such sport is enabled.', 404);
    }

    const response = ok({ ok: true, sportKey });
    response.cookies.set(SPORT_COOKIE, sportKey, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.appUrl.startsWith('https://'),
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
    });
    return response;
  }, 'POST /api/sports/select');
}
