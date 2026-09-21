import Link from 'next/link';
import { ChevronRight, Download, Target } from 'lucide-react';

import { CalibrationChart, TimelineChart } from '@/components/accuracy/charts';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader, StatCard } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { accuracyReport } from '@/lib/engine/accuracy';
import { MODEL_DESCRIPTIONS, MODEL_LABELS, sportDefinition } from '@/lib/sports/registry';
import { listEnabledSports, resolveSportSelection } from '@/lib/sports/selection';
import { formatDate } from '@/lib/time';
import { cn, formatInt } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const ORDER = ['ensemble', 'dixon-coles', 'margin', 'ml', 'elo', 'ai', 'market', 'baseline'];

export default async function AccuracyPage() {
  const sports = await listEnabledSports();
  const { selected } = await resolveSportSelection(sports);
  const report = await accuracyReport(selected?.key ?? null);
  const ensemble = report.models.ensemble;
  const baseline = report.models.baseline;
  const modelKeys = Object.keys(report.models).sort((a, b) => (ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b)));
  const sport = selected ? sportDefinition(selected.key) : null;
  const statDefs = new Map((sport?.stats ?? []).map((s) => [s.key, s]));

  return (
    <>
      <PageHeader
        title="Accuracy"
        description={
          report.total > 0
            ? `${formatInt(report.total)} final predictions scored${report.since ? ` since ${formatDate(report.since)}` : ''}. Lower log loss, Brier and RPS are better.`
            : 'Every final prediction is scored against the result: Brier, log loss, ranked probability score, calibration.'
        }
        actions={
          report.total > 0 ? (
            <Button asChild variant="outline" size="sm">
              <a href={`/api/export?sport=${selected?.key ?? 'all'}`}>
                <Download />
                Export CSV
              </a>
            </Button>
          ) : undefined
        }
      />
      {report.total === 0 ? (
        <EmptyState
          icon={Target}
          title="No scored predictions yet"
          description="Predictions are scored automatically once their events finish. Run a backtest in the Lab to see how the models would have done on history."
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Log loss" value={ensemble ? ensemble.logLoss.toFixed(3) : '--'} hint={baseline ? `baseline ${baseline.logLoss.toFixed(3)}` : undefined} tone={ensemble && baseline && ensemble.logLoss < baseline.logLoss ? 'success' : 'default'} />
            <StatCard label="Brier score" value={ensemble ? ensemble.brier.toFixed(3) : '--'} hint={baseline ? `baseline ${baseline.brier.toFixed(3)}` : undefined} />
            <StatCard label={ensemble?.rps !== null ? 'RPS' : 'Accuracy'} value={ensemble ? (ensemble.rps !== null ? ensemble.rps.toFixed(3) : `${Math.round(ensemble.accuracy * 100)}%`) : '--'} hint={ensemble ? `favourite won ${Math.round(ensemble.accuracy * 100)}% of the time` : undefined} />
            <StatCard
              label="Calibration slope"
              value={report.calibrationSlope !== null ? report.calibrationSlope.toFixed(2) : '--'}
              hint={report.calibrationSlope === null ? 'needs more scored predictions' : report.calibrationSlope > 1.1 ? 'under-confident' : report.calibrationSlope < 0.9 ? 'over-confident' : 'well calibrated (1.0 is perfect)'}
              tone={report.calibrationSlope !== null && Math.abs(report.calibrationSlope - 1) <= 0.1 ? 'success' : 'default'}
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Model by model</CardTitle>
              <CardDescription className="mt-1">
                Every model is scored on the same events. Lower log loss, Brier and RPS are better; the baseline is the league&apos;s own home / draw / away frequency, and anything that cannot beat it is not earning its place.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Model</TableHead>
                    <TableHead className="text-right">n</TableHead>
                    <TableHead className="text-right">Log loss</TableHead>
                    <TableHead className="text-right">Brier</TableHead>
                    <TableHead className="text-right">RPS</TableHead>
                    <TableHead className="text-right">Accuracy</TableHead>
                    <TableHead className="pr-4 text-right">Exact score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modelKeys.map((key) => {
                    const m = report.models[key];
                    const best = baseline && m.logLoss < baseline.logLoss && key !== 'baseline';
                    return (
                      <TableRow key={key} className={cn(key === 'ensemble' && 'bg-primary/5')}>
                        <TableCell className="min-w-[8rem] pl-4 font-medium">{MODEL_LABELS[key] ?? key}</TableCell>
                        <TableCell className="tnum text-right">{formatInt(m.n)}</TableCell>
                        <TableCell className={cn('tnum text-right', best && 'text-success')}>{m.logLoss.toFixed(3)}</TableCell>
                        <TableCell className="tnum text-right">{m.brier.toFixed(3)}</TableCell>
                        <TableCell className="tnum text-right">{m.rps !== null ? m.rps.toFixed(3) : '-'}</TableCell>
                        <TableCell className="tnum text-right">{Math.round(m.accuracy * 100)}%</TableCell>
                        <TableCell className="tnum pr-4 text-right">{m.exactScoreRate !== null ? `${Math.round(m.exactScoreRate * 100)}%` : '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <details className="group border-t px-4 pt-3 sm:px-5">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                  What each model does
                </summary>
                <dl className="mt-2 space-y-2 pl-[1.125rem]">
                  {modelKeys
                    .filter((key) => MODEL_DESCRIPTIONS[key])
                    .map((key) => (
                      <div key={key}>
                        <dt className="text-sm font-medium">{MODEL_LABELS[key] ?? key}</dt>
                        <dd className="text-[11px] leading-snug text-muted-foreground">{MODEL_DESCRIPTIONS[key]}</dd>
                      </div>
                    ))}
                </dl>
              </details>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Log loss by week</CardTitle>
                <CardDescription className="mt-1">Mean over the events scored each week. Drift upward means the models need a refit.</CardDescription>
              </CardHeader>
              <CardContent>
                <TimelineChart points={report.timeline} models={report.timelineModels.filter((m) => ['ensemble', 'baseline', 'dixon-coles', 'margin', 'elo', 'ml', 'ai'].includes(m))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Reliability</CardTitle>
                <CardDescription className="mt-1">When the ensemble says 60%, does it happen 60% of the time? Points on the diagonal are perfect; the dot size is the count.</CardDescription>
              </CardHeader>
              <CardContent>
                <CalibrationChart bins={report.calibration} />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">By competition</CardTitle>
              </CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Competition</TableHead>
                      <TableHead className="text-right">n</TableHead>
                      <TableHead className="text-right">Log loss</TableHead>
                      <TableHead className="text-right">RPS</TableHead>
                      <TableHead className="pr-4 text-right">Accuracy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byCompetition.map((c) => (
                      <TableRow key={c.competitionId}>
                        <TableCell className="pl-4">
                          <Link href={`/leagues/${c.competitionId}`} className="hover:underline">
                            {c.name}
                          </Link>
                        </TableCell>
                        <TableCell className="tnum text-right">{formatInt(c.summary.n)}</TableCell>
                        <TableCell className="tnum text-right">{c.summary.logLoss.toFixed(3)}</TableCell>
                        <TableCell className="tnum text-right">{c.summary.rps !== null ? c.summary.rps.toFixed(3) : '-'}</TableCell>
                        <TableCell className="tnum pr-4 text-right">{Math.round(c.summary.accuracy * 100)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Stat forecasts</CardTitle>
                <CardDescription className="mt-1">How often the actual value fell inside the forecast range, and the average miss.</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {report.statCoverage.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">No stat forecasts scored yet.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Stat</TableHead>
                        <TableHead className="text-right">n</TableHead>
                        <TableHead className="text-right">In range</TableHead>
                        <TableHead className="pr-4 text-right">Mean miss</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.statCoverage.map((s) => (
                        <TableRow key={s.key}>
                          <TableCell className="pl-4">{statDefs.get(s.key)?.label ?? s.key}</TableCell>
                          <TableCell className="tnum text-right">{formatInt(s.n)}</TableCell>
                          <TableCell className={cn('tnum text-right', s.withinRange >= 0.75 ? 'text-success' : s.withinRange < 0.6 ? 'text-warning' : '')}>{Math.round(s.withinRange * 100)}%</TableCell>
                          <TableCell className="tnum pr-4 text-right">{s.meanAbsError.toFixed(statDefs.get(s.key)?.decimals ?? 1)}{statDefs.get(s.key)?.unit ?? ''}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          {report.picks.n > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">You against the model</CardTitle>
                <CardDescription className="mt-1">Your picks on finished events, and how often the ensemble favourite won on the same events.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="tnum text-2xl font-semibold">{formatInt(report.picks.n)}</p>
                  <p className="text-xs text-muted-foreground">picks scored</p>
                </div>
                <div>
                  <p className={cn('tnum text-2xl font-semibold', report.picks.correct >= report.picks.modelCorrect ? 'text-success' : '')}>{Math.round((report.picks.correct / report.picks.n) * 100)}%</p>
                  <p className="text-xs text-muted-foreground">you were right</p>
                </div>
                <div>
                  <p className="tnum text-2xl font-semibold">{Math.round((report.picks.modelCorrect / report.picks.n) * 100)}%</p>
                  <p className="text-xs text-muted-foreground">the model was right</p>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {report.upsets.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Biggest upsets</CardTitle>
                <CardDescription className="mt-1">Where a strong favourite lost. Worth a look for what the models missed.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {report.upsets.map((u) => (
                    <li key={u.eventId} className="flex items-center gap-3 py-2">
                      <Link href={`/events/${u.eventId}`} className="min-w-0 flex-1 truncate hover:underline">
                        {u.label}
                      </Link>
                      <span className="text-xs text-muted-foreground">{formatDate(u.date)}</span>
                      <span className="tnum text-xs">favourite {u.favourite}%</span>
                      <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger">{u.outcome.toLowerCase()} won</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
