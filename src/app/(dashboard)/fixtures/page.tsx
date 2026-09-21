import Link from 'next/link';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

import { EventCard } from '@/components/events/event-card';
import { EmptyState } from '@/components/shared/empty-state';
import { RunJobButton } from '@/components/shared/run-job-button';
import { PageHeader } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { prisma, withDatabase } from '@/lib/prisma';
import { EVENT_INCLUDE, serializeEvent } from '@/lib/serialize';
import { listEnabledSports, resolveSportSelection, sportScope } from '@/lib/sports/selection';
import { addDays, dayKey, formatDayHeading, startOfDayUtc, zonedTimeToUtc } from '@/lib/time';

export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 7;

function parseDate(value: string | undefined): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return zonedTimeToUtc(y, m, d);
  }
  return startOfDayUtc();
}

export default async function FixturesPage({ searchParams }: { searchParams: { date?: string } }) {
  const sports = await listEnabledSports();
  const { selected, selectedKey } = await resolveSportSelection(sports);
  const from = parseDate(searchParams.date);
  const to = addDays(from, WINDOW_DAYS);

  const rows = await withDatabase(() =>
    prisma.event.findMany({
      where: { ...sportScope(selected), startsAt: { gte: from, lt: to } },
      include: EVENT_INCLUDE,
      orderBy: [{ startsAt: 'asc' }],
      take: 500,
    }),
  );
  const events = rows.ok ? rows.data.map(serializeEvent) : [];

  const byDay = new Map<string, typeof events>();
  for (const event of events) {
    const key = dayKey(new Date(event.startsAt));
    const list = byDay.get(key) ?? [];
    list.push(event);
    byDay.set(key, list);
  }

  const prev = dayKey(addDays(from, -WINDOW_DAYS));
  const next = dayKey(addDays(from, WINDOW_DAYS));
  const today = dayKey();

  return (
    <>
      <PageHeader
        title="Fixtures"
        description={`${formatDayHeading(from)} to ${formatDayHeading(addDays(to, -1))}`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/fixtures?date=${prev}`}>
                <ChevronLeft />
                Earlier
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/fixtures?date=${today}`}>Today</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/fixtures?date=${next}`}>
                Later
                <ChevronRight />
              </Link>
            </Button>
            <RunJobButton job="sync:fixtures" sportKey={selectedKey} label="Sync" size="sm" icon="refresh" variant="secondary" disabled={sports.length === 0} />
          </>
        }
      />
      {events.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No fixtures in this window"
          description="Follow a competition in Settings and run a sync, or move to another week."
        />
      ) : (
        <div className="space-y-6">
          {Array.from(byDay.entries()).map(([key, list]) => (
            <section key={key}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {formatDayHeading(list[0].startsAt)}
                {key === today ? <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] text-primary">today</span> : null}
              </h2>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {list.map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
