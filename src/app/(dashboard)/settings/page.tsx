import { LiveProvider, RunProgress } from '@/components/live/live-status';
import { GlobalSettingsForm } from '@/components/settings/global-form';
import { ProvidersPanel } from '@/components/settings/providers-panel';
import { SportsPanel, type SportRow } from '@/components/settings/sports-panel';
import { PageHeader } from '@/components/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { env, integrationStatus } from '@/lib/env';
import { prisma, withDatabase } from '@/lib/prisma';
import { usageToday } from '@/lib/providers/budget';
import { serializeCompetition, serializeSport } from '@/lib/serialize';
import { getGlobalSettings, getSettingsForSports } from '@/lib/settings';
import { listAllSports } from '@/lib/sports/selection';
import type { LiveResponse } from '@/app/api/live/route';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [sports, global, usage, status] = await Promise.all([listAllSports(), getGlobalSettings(), usageToday(), Promise.resolve(integrationStatus())]);
  const perSport = await getSettingsForSports(sports.map((s) => s.key));
  const competitions = await withDatabase(() =>
    prisma.competition.findMany({
      orderBy: [{ followed: 'desc' }, { tier: 'asc' }, { country: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { events: true } } },
    }),
  );
  const rows: SportRow[] = sports.map((sport) => {
    const own = (competitions.ok ? competitions.data : []).filter((c) => c.sportKey === sport.key);
    return {
      ...serializeSport(sport),
      followed: own.filter((c) => c.followed).length,
      competitions: own.map((c) => ({ ...serializeCompetition(c), events: c._count.events })),
      settings: perSport.get(sport.key)!,
    };
  });

  const initialLive: LiveResponse = {
    run: null,
    runningJobs: [],
    lastFinished: null,
    liveEvents: 0,
    nextKickoff: null,
    usage: usage.filter((u) => u.configured).map((u) => ({ provider: u.provider, label: u.label, requests: u.requests, dailyBudget: u.dailyBudget, configured: u.configured })),
  };

  return (
    <LiveProvider initial={initialLive}>
      <PageHeader title="Settings" description="Sports, competitions, data providers, the AI layer and the schedule." />
      <div className="space-y-5">
        <RunProgress />
        <SportsPanel sports={rows} />
        <GlobalSettingsForm initial={global} status={status} />
        <ProvidersPanel usage={usage} />
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Server</CardTitle>
            <CardDescription className="mt-1">What is configured in .env. Values are never shown, only whether they exist.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Public URL</dt>
              <dd>{env.appUrl}</dd>
              <dt className="text-muted-foreground">Timezone</dt>
              <dd>{env.timezone}</dd>
              <dt className="text-muted-foreground">Google sign-in</dt>
              <dd>{status.googleLogin ? `configured (${env.dashboardAllowedEmails.length} allowed)` : 'not configured'}</dd>
              <dt className="text-muted-foreground">Password sign-in</dt>
              <dd>{status.password ? 'enabled' : 'disabled'}</dd>
              <dt className="text-muted-foreground">Demo leagues</dt>
              <dd>{status.mockSports ? 'on (MOCK_SPORTS=true)' : 'off'}</dd>
              <dt className="text-muted-foreground">Scheduler</dt>
              <dd>{env.schedulerEnabled ? 'in-process, every minute' : 'disabled (host cron drives /api/jobs/run)'}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </LiveProvider>
  );
}
