import Link from 'next/link';
import { CalendarDays, Gauge, Sparkles, Target, Trophy } from 'lucide-react';

import { EventCard } from '@/components/events/event-card';
import { LiveProvider, RunProgress } from '@/components/live/live-status';
import { EmptyState } from '@/components/shared/empty-state';
import { RunJobButton } from '@/components/shared/run-job-button';
import { SetupChecklist } from '@/components/shared/setup-checklist';
import { PageHeader, StatCard } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { LiveResponse } from '@/app/api/live/route';
import { integrationStatus } from '@/lib/env';
import { isJobRunning } from '@/lib/jobs/runner';
import { prisma, withDatabase } from '@/lib/prisma';
import { usageToday } from '@/lib/providers/budget';
import { EVENT_INCLUDE, serializeEvent, serializeRun } from '@/lib/serialize';
import { listEnabledSports, resolveSportSelection, sportScope } from '@/lib/sports/selection';
import { addDays, formatDayHeading, startOfDayUtc } from '@/lib/time';
import { formatInt } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const sports = await listEnabledSports();
  const { selected, selectedKey } = await resolveSportSelection(sports);
  const scope = sportScope(selected);
  const status = integrationStatus();

  const todayStart = startOfDayUtc();
  const windowEnd = addDays(todayStart, 2);

  const [counts, events, runs, usage] = await Promise.all([
    withDatabase(async () => {
      const [followed, eventsKnown, scored] = await Promise.all([
        prisma.competition.count({ where: { ...scope, followed: true } }),
        prisma.event.count({ where: scope }),
        prisma.evaluation.count({ where: { modelKey: 'ensemble', createdAt: { gte: addDays(todayStart, -30) }, event: scope } }),
      ]);
      return { followed, eventsKnown, scored };
    }),
    withDatabase(() =>
      prisma.event.findMany({
        where: { ...scope, startsAt: { gte: todayStart, lt: windowEnd } },
        include: EVENT_INCLUDE,
        orderBy: { startsAt: 'asc' },
        take: 200,
      }),
    ),
    withDatabase(() => prisma.modelRun.findMany({ orderBy: { startedAt: 'desc' }, take: 5 })),
    usageToday(),
  ]);
  const c = counts.ok ? counts.data : { followed: 0, eventsKnown: 0, scored: 0 };
  const list = events.ok ? events.data.map(serializeEvent) : [];
  const predicted = list.filter((e) => e.prediction).length;
  const live = list.filter((e) => e.status === 'LIVE').length;

  const running = runs.ok ? runs.data.find((r) => r.status === 'RUNNING' && isJobRunning()) ?? null : null;
  const lastFinished = runs.ok ? runs.data.find((r) => r.status !== 'RUNNING') ?? null : null;
  const configuredUsage = usage.filter((u) => u.configured);
  const budgeted = configuredUsage.filter((u) => u.dailyBudget > 0);
  const initialLive: LiveResponse = {
    run: running ? serializeRun(running) : null,
    runningJobs: [],
    lastFinished: lastFinished ? serializeRun(lastFinished) : null,
    liveEvents: live,
    nextKickoff: null,
    usage: configuredUsage.map((u) => ({ provider: u.provider, label: u.label, requests: u.requests, dailyBudget: u.dailyBudget, configured: u.configured })),
  };

  const byCompetition = new Map<string, { name: string; events: typeof list }>();
  for (const event of list) {
    const entry = byCompetition.get(event.competition.id) ?? { name: event.competition.name, events: [] };
    entry.events.push(event);
    byCompetition.set(event.competition.id, entry);
  }

  return (
    <LiveProvider initial={initialLive}>
      <PageHeader
        title={selected ? selected.name : sports.length > 0 ? 'All sports' : 'Today'}
        description={
          c.followed > 0
            ? `${formatInt(c.followed)} competition${c.followed === 1 ? '' : 's'} followed. ${formatDayHeading(todayStart)} and tomorrow.`
            : 'Follow a competition in Settings to start seeing fixtures and predictions here.'
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/fixtures">
                <CalendarDays />
                Fixtures
              </Link>
            </Button>
            <RunJobButton job="sync:results" sportKey={selectedKey} label="Sync now" busyLabel="Syncing..." icon="refresh" disabled={sports.length === 0} />
          </>
        }
      />

      <div className="space-y-5">
        <SetupChecklist status={status} enabledSports={sports.length} followedCompetitions={c.followed} eventsKnown={c.eventsKnown} />
        <RunProgress />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Events today and tomorrow" value={formatInt(list.length)} hint={live > 0 ? `${live} in play now` : undefined} icon={CalendarDays} tone={live > 0 ? 'danger' : 'default'} />
          <StatCard label="Predictions ready" value={`${formatInt(predicted)} / ${formatInt(list.length)}`} hint="Ensemble forecasts for this window" icon={Sparkles} />
          <StatCard label="Competitions followed" value={formatInt(c.followed)} icon={Trophy} />
          <StatCard
            label="API budget used today"
            value={budgeted.length > 0 ? `${Math.round((Math.max(...budgeted.map((u) => u.requests / u.dailyBudget)) || 0) * 100)}%` : '--'}
            hint={budgeted.length > 0 ? budgeted.map((u) => `${u.label} ${u.requests}/${u.dailyBudget}`).join(', ') : 'No budgeted provider configured'}
            icon={Gauge}
          />
        </div>

        {list.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={CalendarDays}
                title="No fixtures today or tomorrow"
                description={
                  c.followed === 0
                    ? 'Once a competition is followed and synced, each fixture appears here with its win probabilities and predicted score.'
                    : 'Nothing scheduled in this window. The Fixtures page shows the whole week.'
                }
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link href={c.followed === 0 ? '/settings' : '/fixtures'}>{c.followed === 0 ? 'Choose sports and competitions' : 'Open fixtures'}</Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          Array.from(byCompetition.entries()).map(([id, entry]) => (
            <Card key={id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  <Link href={`/leagues/${id}`} className="hover:underline">
                    {entry.name}
                  </Link>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {entry.events.map((event) => (
                  <EventCard key={event.id} event={event} showCompetition={false} />
                ))}
              </CardContent>
            </Card>
          ))
        )}

        <p className="pb-2 text-center text-xs text-muted-foreground">
          <Target className="mr-1 inline size-3" />
          {c.scored > 0 ? `${formatInt(c.scored)} predictions scored in the last 30 days.` : 'Predictions are scored automatically once results arrive.'} ScoreSage is for personal analysis only.
        </p>
      </div>
    </LiveProvider>
  );
}
