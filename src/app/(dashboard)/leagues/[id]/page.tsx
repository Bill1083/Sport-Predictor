import { notFound } from 'next/navigation';

import { EventCard } from '@/components/events/event-card';
import { SimulationTable } from '@/components/leagues/simulation-table';
import { StandingsTable } from '@/components/leagues/standings-table';
import { PageHeader } from '@/components/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { simulateSeason } from '@/lib/engine/simulate';
import { prisma, withDatabase } from '@/lib/prisma';
import { EVENT_INCLUDE, serializeEvent } from '@/lib/serialize';
import { competitionTable } from '@/lib/standings';
import { formatInt } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function LeaguePage({ params }: { params: { id: string } }) {
  const competition = await withDatabase(() => prisma.competition.findUnique({ where: { id: params.id } }));
  if (!competition.ok || !competition.data) notFound();
  const c = competition.data;
  const season = c.currentSeason ?? '';
  const now = new Date();

  const [table, upcoming, recent, simulation] = await Promise.all([
    competitionTable(c.id, season),
    withDatabase(() =>
      prisma.event.findMany({
        where: { competitionId: c.id, status: { in: ['SCHEDULED', 'LIVE'] }, startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000) } },
        include: EVENT_INCLUDE,
        orderBy: { startsAt: 'asc' },
        take: 12,
      }),
    ),
    withDatabase(() =>
      prisma.event.findMany({
        where: { competitionId: c.id, status: 'FINISHED' },
        include: EVENT_INCLUDE,
        orderBy: { startsAt: 'desc' },
        take: 12,
      }),
    ),
    c.type === 'LEAGUE' ? simulateSeason(c.id).catch(() => null) : Promise.resolve(null),
  ]);
  const zones = c.type === 'LEAGUE' && table.length >= 10 ? { top: 1, europe: simulation?.zones.top ?? 4, bottom: simulation?.zones.bottom ?? 3 } : undefined;

  return (
    <>
      <PageHeader title={c.name} description={[c.country, season ? `Season ${season}` : null, `${table.length} teams`].filter(Boolean).join(' - ')} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Table</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {table.length === 0 ? <p className="px-4 py-4 text-sm text-muted-foreground">No results synced yet.</p> : <StandingsTable rows={table} zones={zones} />}
            </CardContent>
          </Card>
          {simulation && simulation.remaining > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Simulated finish</CardTitle>
                <CardDescription className="mt-1">
                  The remaining {formatInt(simulation.remaining)} fixtures played {formatInt(simulation.runs)} times from the models&apos; scoreline distributions. Expected points, expected position and the chance of each finish.
                </CardDescription>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                <SimulationTable simulation={simulation} />
              </CardContent>
            </Card>
          ) : null}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Next up</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {upcoming.ok && upcoming.data.length > 0 ? (
                upcoming.data.map((e) => <EventCard key={e.id} event={serializeEvent(e)} showCompetition={false} />)
              ) : (
                <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recent.ok && recent.data.length > 0 ? (
                recent.data.map((e) => <EventCard key={e.id} event={serializeEvent(e)} showCompetition={false} />)
              ) : (
                <p className="text-sm text-muted-foreground">No results yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
