import { notFound } from 'next/navigation';
import { HeartPulse } from 'lucide-react';

import { EventCard } from '@/components/events/event-card';
import { Crest } from '@/components/events/primitives';
import { PageHeader } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma, withDatabase } from '@/lib/prisma';
import { EVENT_INCLUDE, serializeEvent } from '@/lib/serialize';
import { formatDate } from '@/lib/time';

export const dynamic = 'force-dynamic';

export default async function TeamPage({ params }: { params: { id: string } }) {
  const team = await withDatabase(() => prisma.team.findUnique({ where: { id: params.id }, include: { venue: true } }));
  if (!team.ok || !team.data) notFound();
  const t = team.data;
  const now = new Date();

  const [upcoming, recent, injuries, ratings] = await Promise.all([
    withDatabase(() =>
      prisma.event.findMany({
        where: { OR: [{ homeTeamId: t.id }, { awayTeamId: t.id }, { participants: { some: { teamId: t.id } } }], status: { in: ['SCHEDULED', 'LIVE'] }, startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000) } },
        include: EVENT_INCLUDE,
        orderBy: { startsAt: 'asc' },
        take: 6,
      }),
    ),
    withDatabase(() =>
      prisma.event.findMany({
        where: { OR: [{ homeTeamId: t.id }, { awayTeamId: t.id }, { participants: { some: { teamId: t.id } } }], status: 'FINISHED' },
        include: EVENT_INCLUDE,
        orderBy: { startsAt: 'desc' },
        take: 10,
      }),
    ),
    withDatabase(() => prisma.injury.findMany({ where: { teamId: t.id, resolvedAt: null }, orderBy: { reportedAt: 'desc' } })),
    withDatabase(() => prisma.rating.findMany({ where: { teamId: t.id, model: 'ELO' }, orderBy: { asOf: 'desc' }, take: 1 })),
  ]);
  const elo = ratings.ok && ratings.data[0] ? ratings.data[0].value : null;

  return (
    <>
      <div className="mb-5 flex items-center gap-4">
        <Crest name={t.name} code={t.code} crestUrl={t.crestUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <PageHeader
            title={t.name}
            description={[t.country, t.venue ? `${t.venue.name}${t.venue.city ? `, ${t.venue.city}` : ''}` : null, t.founded ? `founded ${t.founded}` : null, elo !== null ? `Elo ${Math.round(elo)}` : null]
              .filter(Boolean)
              .join(' - ')}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Next up</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.ok && upcoming.data.length > 0 ? upcoming.data.map((e) => <EventCard key={e.id} event={serializeEvent(e)} />) : <p className="text-sm text-muted-foreground">Nothing scheduled.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.ok && recent.data.length > 0 ? recent.data.map((e) => <EventCard key={e.id} event={serializeEvent(e)} />) : <p className="text-sm text-muted-foreground">No results yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <HeartPulse className="size-4 text-danger" />
              Absences
            </CardTitle>
          </CardHeader>
          <CardContent>
            {injuries.ok && injuries.data.length > 0 ? (
              <ul className="divide-y text-sm">
                {injuries.data.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 py-2">
                    <span className="flex-1">
                      {i.playerName}
                      <span className="block text-xs text-muted-foreground">
                        {[i.type, i.reason, i.expectedReturn ? `back ${formatDate(i.expectedReturn)}` : null].filter(Boolean).join(' - ')}
                      </span>
                    </span>
                    <Badge variant={i.status === 'OUT' || i.status === 'SUSPENDED' ? 'danger' : 'warning'}>{i.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No known absences.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
