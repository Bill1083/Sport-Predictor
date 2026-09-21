import Link from 'next/link';
import { ArrowRight, Trophy } from 'lucide-react';

import { StandingsTable } from '@/components/leagues/standings-table';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { prisma, withDatabase } from '@/lib/prisma';
import { listEnabledSports, resolveSportSelection, sportScope } from '@/lib/sports/selection';
import { competitionTable } from '@/lib/standings';

export const dynamic = 'force-dynamic';

export default async function LeaguesPage() {
  const sports = await listEnabledSports();
  const { selected } = await resolveSportSelection(sports);
  const competitions = await withDatabase(() =>
    prisma.competition.findMany({ where: { ...sportScope(selected), followed: true }, orderBy: [{ tier: 'asc' }, { name: 'asc' }] }),
  );
  const list = competitions.ok ? competitions.data : [];
  const tables = await Promise.all(list.map((c) => competitionTable(c.id, c.currentSeason ?? '')));

  return (
    <>
      <PageHeader title="Leagues" description="Tables computed from results, with the simulated finish once the engine is running." />
      {list.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="No competitions followed"
          description="Follow a league or cup in Settings to see its table here."
          action={
            <Button asChild size="sm">
              <Link href="/settings">Open settings</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {list.map((competition, index) => (
            <Card key={competition.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">{competition.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {[competition.country, competition.currentSeason ? `Season ${competition.currentSeason}` : null].filter(Boolean).join(' - ')}
                    </CardDescription>
                  </div>
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/leagues/${competition.id}`}>
                      Full table
                      <ArrowRight />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                {tables[index].length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">No results synced yet.</p>
                ) : (
                  <StandingsTable rows={tables[index].slice(0, 8)} compact />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
