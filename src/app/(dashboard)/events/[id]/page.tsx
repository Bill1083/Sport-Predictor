import { notFound } from 'next/navigation';

import { MatchCentre } from '@/components/events/match-centre';
import { RaceCentre } from '@/components/events/race-centre';
import { prisma, withDatabase } from '@/lib/prisma';
import { EVENT_INCLUDE, serializeEvent, serializePrediction } from '@/lib/serialize';
import { sportDefinition } from '@/lib/sports/registry';
import { competitionTable } from '@/lib/standings';
import { parseStringArray } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function EventPage({ params }: { params: { id: string } }) {
  const row = await withDatabase(() =>
    prisma.event.findUnique({
      where: { id: params.id },
      include: {
        ...EVENT_INCLUDE,
        predictions: { orderBy: [{ modelKey: 'asc' }, { version: 'desc' }] },
        lineups: true,
        stats: true,
        pick: true,
      },
    }),
  );
  if (!row.ok || !row.data) notFound();
  const e = row.data;
  if (sportDefinition(e.sportKey)?.shape === 'MULTI_ENTRANT') {
    return <RaceCentre event={serializeEvent(e)} predictions={e.predictions.map(serializePrediction)} />;
  }
  const teamIds = [e.homeTeamId, e.awayTeamId].filter((id): id is string => Boolean(id));

  const [table, injuries, h2h, homeForm, awayForm, news] = await Promise.all([
    competitionTable(e.competitionId, e.season, e.status === 'FINISHED' ? e.startsAt : undefined),
    withDatabase(() => prisma.injury.findMany({ where: { teamId: { in: teamIds }, resolvedAt: null }, orderBy: { reportedAt: 'desc' } })),
    withDatabase(() =>
      prisma.event.findMany({
        where: {
          id: { not: e.id },
          status: 'FINISHED',
          OR: [
            { homeTeamId: e.homeTeamId, awayTeamId: e.awayTeamId },
            { homeTeamId: e.awayTeamId, awayTeamId: e.homeTeamId },
          ],
        },
        include: EVENT_INCLUDE,
        orderBy: { startsAt: 'desc' },
        take: 6,
      }),
    ),
    withDatabase(() =>
      prisma.event.findMany({
        where: { id: { not: e.id }, status: 'FINISHED', startsAt: { lt: e.startsAt }, OR: [{ homeTeamId: e.homeTeamId }, { awayTeamId: e.homeTeamId }] },
        include: EVENT_INCLUDE,
        orderBy: { startsAt: 'desc' },
        take: 5,
      }),
    ),
    withDatabase(() =>
      prisma.event.findMany({
        where: { id: { not: e.id }, status: 'FINISHED', startsAt: { lt: e.startsAt }, OR: [{ homeTeamId: e.awayTeamId }, { awayTeamId: e.awayTeamId }] },
        include: EVENT_INCLUDE,
        orderBy: { startsAt: 'desc' },
        take: 5,
      }),
    ),
    withDatabase(() =>
      prisma.newsItem.findMany({
        where: { teamId: { in: teamIds }, publishedAt: { gte: new Date(Date.now() - 10 * 86_400_000) } },
        orderBy: { publishedAt: 'desc' },
        take: 12,
      }),
    ),
  ]);

  return (
    <MatchCentre
      event={serializeEvent(e)}
      predictions={e.predictions.map(serializePrediction)}
      table={table}
      injuries={(injuries.ok ? injuries.data : []).map((i) => ({ id: i.id, teamId: i.teamId, playerName: i.playerName, type: i.type, status: i.status, reason: i.reason }))}
      lineups={e.lineups.map((l) => ({ teamId: l.teamId, formation: l.formation, coach: l.coach, confirmed: l.confirmed, starters: parseStringArray(l.startersJson).length ? parseStringArray(l.startersJson) : (JSON.parse(l.startersJson) as { name: string; position?: string; number?: number }[]).map((p) => `${p.number ?? ''} ${p.name}${p.position ? ` (${p.position})` : ''}`.trim()) }))}
      stats={e.stats.map((s) => ({ teamId: s.teamId, stats: JSON.parse(s.statsJson) as Record<string, number> }))}
      h2h={(h2h.ok ? h2h.data : []).map(serializeEvent)}
      homeForm={(homeForm.ok ? homeForm.data : []).map(serializeEvent)}
      awayForm={(awayForm.ok ? awayForm.data : []).map(serializeEvent)}
      headlines={(news.ok ? news.data : []).map((n) => ({ teamId: n.teamId ?? '', title: n.title, url: n.url, source: n.source, publishedAt: n.publishedAt.toISOString() }))}
      pick={e.pick ? { outcome: e.pick.outcome, predictedScore: e.pick.predictedScore, note: e.pick.note } : null}
    />
  );
}
