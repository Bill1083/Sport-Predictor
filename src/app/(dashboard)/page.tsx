import Link from 'next/link';
import { CalendarDays, Sparkles, Target, Trophy } from 'lucide-react';

import { SetupChecklist } from '@/components/shared/setup-checklist';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader, StatCard } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { integrationStatus } from '@/lib/env';
import { prisma, withDatabase } from '@/lib/prisma';
import { listEnabledSports, resolveSportSelection, sportScope } from '@/lib/sports/selection';
import { addDays, startOfDayUtc } from '@/lib/time';
import { formatInt } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function TodayPage() {
  const sports = await listEnabledSports();
  const { selected } = await resolveSportSelection(sports);
  const scope = sportScope(selected);
  const status = integrationStatus();

  const todayStart = startOfDayUtc();
  const tomorrowEnd = addDays(todayStart, 2);

  const counts = await withDatabase(async () => {
    const [eventsToday, followed, eventsKnown, predictionsReady] = await Promise.all([
      prisma.event.count({ where: { ...scope, startsAt: { gte: todayStart, lt: tomorrowEnd } } }),
      prisma.competition.count({ where: { ...scope, followed: true } }),
      prisma.event.count({ where: scope }),
      prisma.prediction.count({
        where: { modelKey: 'ensemble', isFinal: false, event: { ...scope, startsAt: { gte: todayStart, lt: tomorrowEnd } } },
      }),
    ]);
    return { eventsToday, followed, eventsKnown, predictionsReady };
  });
  const c = counts.ok ? counts.data : { eventsToday: 0, followed: 0, eventsKnown: 0, predictionsReady: 0 };

  return (
    <>
      <PageHeader
        title={selected ? selected.name : sports.length > 0 ? 'All sports' : 'Today'}
        description={
          c.followed > 0
            ? `${formatInt(c.followed)} competition${c.followed === 1 ? '' : 's'} followed. Predictions refresh 48h, 24h and 90 minutes before kickoff.`
            : 'Follow a competition in Settings to start seeing fixtures and predictions here.'
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/fixtures">
              <CalendarDays />
              Fixtures
            </Link>
          </Button>
        }
      />

      <div className="space-y-5">
        <SetupChecklist
          status={status}
          enabledSports={sports.length}
          followedCompetitions={c.followed}
          eventsKnown={c.eventsKnown}
        />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Events today and tomorrow" value={formatInt(c.eventsToday)} icon={CalendarDays} />
          <StatCard
            label="Predictions ready"
            value={formatInt(c.predictionsReady)}
            hint="Ensemble forecasts for upcoming events"
            icon={Sparkles}
          />
          <StatCard label="Competitions followed" value={formatInt(c.followed)} icon={Trophy} />
          <StatCard label="Accuracy, 30 days" value="--" hint="Appears once results have been scored" icon={Target} />
        </div>

        <Card>
          <CardContent>
            <EmptyState
              icon={CalendarDays}
              title={c.eventsToday === 0 ? 'No fixtures today' : 'Fixture cards arrive in the next build'}
              description={
                c.followed === 0
                  ? 'Once a competition is followed and synced, each fixture appears here with its win probabilities and predicted score.'
                  : 'Fixtures are synced; the prediction engine wires in next.'
              }
              action={
                <Button asChild size="sm">
                  <Link href="/settings">Choose sports and competitions</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
