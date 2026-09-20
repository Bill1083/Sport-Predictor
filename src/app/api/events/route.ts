import { fail, guard, isDateKey, ok } from '@/lib/api';
import { prisma, withDatabase } from '@/lib/prisma';
import { EVENT_INCLUDE, serializeEvent, type EventDto } from '@/lib/serialize';
import { addDays, startOfDayUtc, zonedTimeToUtc } from '@/lib/time';

export const dynamic = 'force-dynamic';

export interface EventsResponse {
  events: EventDto[];
  from: string;
  to: string;
}

/**
 * GET /api/events?date=YYYY-MM-DD&days=1&sport=&competitionId=&status=&limit=
 *
 * Events in a window of whole days (APP_TIMEZONE), oldest first. Without a
 * date the window starts today.
 */
export async function GET(request: Request) {
  return guard(async () => {
    const url = new URL(request.url);
    const date = url.searchParams.get('date');
    const days = Math.min(60, Math.max(1, Number(url.searchParams.get('days') ?? 1) || 1));
    const sportKey = url.searchParams.get('sport');
    const competitionId = url.searchParams.get('competitionId');
    const status = url.searchParams.get('status');
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200) || 200));

    let from: Date;
    if (date) {
      if (!isDateKey(date)) return fail('date must be YYYY-MM-DD.', 400);
      const [y, m, d] = date.split('-').map(Number);
      from = zonedTimeToUtc(y, m, d);
    } else {
      from = startOfDayUtc();
    }
    const to = addDays(from, days);

    const rows = await withDatabase(() =>
      prisma.event.findMany({
        where: {
          startsAt: { gte: from, lt: to },
          ...(sportKey && sportKey !== 'all' ? { sportKey } : {}),
          ...(competitionId ? { competitionId } : {}),
          ...(status ? { status } : {}),
        },
        include: EVENT_INCLUDE,
        orderBy: [{ startsAt: 'asc' }, { competition: { name: 'asc' } }],
        take: limit,
      }),
    );
    if (!rows.ok) return fail('The database could not be reached.', 503);
    const response: EventsResponse = { events: rows.data.map(serializeEvent), from: from.toISOString(), to: to.toISOString() };
    return ok(response);
  }, 'GET /api/events');
}
