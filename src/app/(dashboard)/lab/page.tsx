import { FlaskConical } from 'lucide-react';

import { ModelsPanel, type ModelRow } from '@/components/lab/models-panel';
import { LiveProvider, RunProgress } from '@/components/live/live-status';
import { RunJobButton } from '@/components/shared/run-job-button';
import { PageHeader } from '@/components/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { LiveResponse } from '@/app/api/live/route';
import { loadModelConfigs } from '@/lib/engine/config';
import type { WalkReport } from '@/lib/engine/walk-forward';
import { JOB_HANDLERS } from '@/lib/jobs/registry';
import { isJobRunning } from '@/lib/jobs/runner';
import { parseJson, prisma, withDatabase } from '@/lib/prisma';
import { usageToday } from '@/lib/providers/budget';
import { serializeRun } from '@/lib/serialize';
import { MODEL_LABELS, isSportKey } from '@/lib/sports/registry';
import { listEnabledSports, resolveSportSelection } from '@/lib/sports/selection';
import { formatDate, formatRelative } from '@/lib/time';
import { cn, formatInt, formatUsd } from '@/lib/utils';

export const dynamic = 'force-dynamic';

function BacktestReport({ report, sportKey }: { report: WalkReport; sportKey: string }) {
  const keys = Object.keys(report.models).sort((a, b) => (a === 'ensemble' ? -1 : b === 'ensemble' ? 1 : a.localeCompare(b)));
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {sportKey}: {formatInt(report.scored)} matches scored{report.from ? ` from ${formatDate(report.from)}` : ''}{report.to ? ` to ${formatDate(report.to)}` : ''}, models learning from {formatInt(report.rows)} in total. Fitted temperature {report.temperature.toFixed(2)}; calibration slope {report.calibrationSlope !== null ? report.calibrationSlope.toFixed(2) : 'n/a'}.
        {Object.keys(report.bestWeights).length > 0 ? ` Best weights: ${Object.entries(report.bestWeights).map(([k, v]) => `${MODEL_LABELS[k] ?? k} ${v.toFixed(1)}`).join(', ')} (log loss ${report.bestWeightsLogLoss.toFixed(3)}).` : ''}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">n</TableHead>
            <TableHead className="text-right">Log loss</TableHead>
            <TableHead className="text-right">Brier</TableHead>
            <TableHead className="text-right">RPS</TableHead>
            <TableHead className="text-right">Accuracy</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => {
            const m = report.models[key];
            const base = report.models.baseline;
            return (
              <TableRow key={key} className={cn(key.startsWith('ensemble') && 'bg-primary/5')}>
                <TableCell className="font-medium">{MODEL_LABELS[key] ?? (key === 'ensemble-calibrated' ? 'Ensemble, calibrated' : key)}</TableCell>
                <TableCell className="tnum text-right">{formatInt(m.n)}</TableCell>
                <TableCell className={cn('tnum text-right', base && key !== 'baseline' && m.logLoss < base.logLoss && 'text-success')}>{m.logLoss.toFixed(3)}</TableCell>
                <TableCell className="tnum text-right">{m.brier.toFixed(3)}</TableCell>
                <TableCell className="tnum text-right">{m.rps !== null ? m.rps.toFixed(3) : '-'}</TableCell>
                <TableCell className="tnum text-right">{Math.round(m.accuracy * 100)}%</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function LabPage() {
  const sports = await listEnabledSports();
  const { selected, selectedKey } = await resolveSportSelection(sports);
  const focus = selected ?? sports[0] ?? null;
  const [runs, usage, lastBacktest] = await Promise.all([
    withDatabase(() => prisma.modelRun.findMany({ orderBy: { startedAt: 'desc' }, take: 30 })),
    usageToday(),
    withDatabase(() => prisma.modelRun.findFirst({ where: { kind: 'BACKTEST', status: { in: ['OK', 'PARTIAL'] }, ...(focus ? { sportKey: focus.key } : {}) }, orderBy: { startedAt: 'desc' } })),
  ]);
  const models: ModelRow[] = [];
  if (focus && isSportKey(focus.key)) {
    const configs = await loadModelConfigs(focus.key);
    for (const loaded of configs.values()) {
      models.push({ ...loaded.settings, fittedAt: loaded.fittedAt ? loaded.fittedAt.toISOString() : null, hasState: Boolean(loaded.state) });
    }
  }
  const backtestReports = lastBacktest.ok && lastBacktest.data ? parseJson<Record<string, WalkReport>>(lastBacktest.data.metricsJson, {}) : {};

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
      <PageHeader title="Lab" description="Run jobs by hand, tune the models, backtest them on history and refit." />
      <div className="space-y-5">
        <RunProgress />
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="size-4" />
              Jobs
            </CardTitle>
            <CardDescription className="mt-1">
              Each runs for the sport chosen in the header{selectedKey === 'all' ? ' (all sports)' : ''}. The scheduler runs the recurring ones on its own; backtest and backfill are manual.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {jobs.map(([name, handler]) => (
              <RunJobButton
                key={name}
                job={name}
                sportKey={selectedKey}
                label={handler.label}
                variant={handler.kind === 'SYNC' ? 'outline' : handler.defaultIntervalMinutes === null ? 'secondary' : 'default'}
                size="sm"
                disabled={sports.length === 0}
              />
            ))}
          </CardContent>
        </Card>

        {focus && models.length > 0 ? <ModelsPanel sport={focus.key} sportName={focus.name} models={models} /> : null}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Last backtest</CardTitle>
            <CardDescription className="mt-1">
              Walk-forward over history: each week is predicted by models fitted only on the weeks before it, so these numbers are honest. The last two seasons are scored.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(backtestReports).length === 0 ? (
              <p className="text-sm text-muted-foreground">No backtest yet. Press Backtest above once a few hundred finished matches are in.</p>
            ) : (
              <div className="space-y-6">
                {Object.entries(backtestReports).map(([sportKey, report]) => (
                  <BacktestReport key={sportKey} report={report} sportKey={sportKey} />
                ))}
              </div>
            )}
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
                        <Badge variant={run.status === 'OK' ? 'success' : run.status === 'FAILED' ? 'danger' : run.status === 'PARTIAL' ? 'warning' : 'secondary'}>{run.status.toLowerCase()}</Badge>
                      </TableCell>
                      <TableCell className="max-w-md truncate text-xs text-muted-foreground" title={dto.summary ?? undefined}>
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
