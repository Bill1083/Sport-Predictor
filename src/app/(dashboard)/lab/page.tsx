import { FlaskConical } from 'lucide-react';

import { LiveProvider, RunProgress } from '@/components/live/live-status';
import { RunJobButton } from '@/components/shared/run-job-button';
import { PageHeader } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { LiveResponse } from '@/app/api/live/route';
import { JOB_HANDLERS } from '@/lib/jobs/registry';
import { isJobRunning } from '@/lib/jobs/runner';
import { prisma, withDatabase } from '@/lib/prisma';
import { usageToday } from '@/lib/providers/budget';
import { serializeRun } from '@/lib/serialize';
import { listEnabledSports, resolveSportSelection } from '@/lib/sports/selection';
import { formatRelative } from '@/lib/time';
import { cn, formatUsd } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function LabPage() {
  const sports = await listEnabledSports();
  const { selectedKey } = await resolveSportSelection(sports);
  const [runs, usage] = await Promise.all([
    withDatabase(() => prisma.modelRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 })),
    usageToday(),
  ]);
  const running = runs.ok ? runs.data.find((r) => r.status === 'RUNNING' && isJobRunning()) ?? null : null;
  const lastFinished = runs.ok ? runs.data.find((r) => r.status !== 'RUNNING') ?? null : null;
  const initialLive: LiveResponse = {
    run: running ? serializeRun(running) : null,
    runningJobs: [],
    lastFinished: lastFinished ? serializeRun(lastFinished) : null,
    liveEvents: 0,
    nextKickoff: null,
    usage: usage.filter((u) => u.configured).map((u) => ({ provider: u.provider, label: u.label, requests: u.requests, dailyBudget: u.dailyBudget, configured: u.configured })),
  };
  const jobs = Object.entries(JOB_HANDLERS);

  return (
    <LiveProvider initial={initialLive}>
      <PageHeader title="Lab" description="Run jobs by hand, watch them work, and (once the engine lands) tune, backtest and refit the models." />
      <div className="space-y-5">
        <RunProgress />
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="size-4" />
              Jobs
            </CardTitle>
            <CardDescription className="mt-1">
              Each runs for the sport chosen in the header{selectedKey === 'all' ? ' (all sports)' : ''}. The scheduler runs the recurring ones on its own.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {jobs.map(([name, handler]) => (
              <RunJobButton
                key={name}
                job={name}
                sportKey={selectedKey}
                label={handler.label}
                variant={handler.defaultIntervalMinutes === null ? 'secondary' : 'outline'}
                size="sm"
                disabled={sports.length === 0}
              />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent runs</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Job</TableHead>
                  <TableHead>Sport</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="pr-4 text-right">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(runs.ok ? runs.data : []).map((run) => {
                  const dto = serializeRun(run);
                  return (
                    <TableRow key={run.id}>
                      <TableCell className="pl-4 font-medium">{run.job}</TableCell>
                      <TableCell className="text-muted-foreground">{run.sportKey ?? 'all'}</TableCell>
                      <TableCell>
                        <Badge variant={run.status === 'OK' ? 'success' : run.status === 'FAILED' ? 'danger' : run.status === 'PARTIAL' ? 'warning' : 'secondary'}>
                          {run.status.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className={cn('max-w-md truncate text-xs text-muted-foreground')} title={dto.summary ?? undefined}>
                        {dto.summary ?? run.error ?? ''}
                      </TableCell>
                      <TableCell className="tnum text-right text-xs">{run.costUsd > 0 ? formatUsd(run.costUsd) : '-'}</TableCell>
                      <TableCell className="tnum pr-4 text-right text-xs text-muted-foreground">{formatRelative(run.startedAt)}</TableCell>
                    </TableRow>
                  );
                })}
                {runs.ok && runs.data.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                      Nothing has run yet.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </LiveProvider>
  );
}
