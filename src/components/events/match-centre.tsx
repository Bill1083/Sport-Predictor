import Link from 'next/link';
import { ChevronRight, CloudSun, HeartPulse, MapPin, Newspaper, Sparkles, Users } from 'lucide-react';

import { EventCard } from '@/components/events/event-card';
import { PickPanel, type PickDto } from '@/components/events/pick-panel';
import { PredictButton } from '@/components/events/predict-button';
import { Crest, FormDots, ProbBar, StatusChip } from '@/components/events/primitives';
import { StandingsTable } from '@/components/leagues/standings-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { EventDto, PredictionDto } from '@/lib/serialize';
import { MODEL_DESCRIPTIONS, MODEL_LABELS, outcomesFor, sportDefinition } from '@/lib/sports/registry';
import type { TableRow } from '@/lib/standings';
import { resultWinner } from '@/lib/types';
import { formatDate, formatDateTime } from '@/lib/time';
import { cn, ordinal } from '@/lib/utils';

export interface MatchCentreProps {
  event: EventDto;
  predictions: PredictionDto[];
  table: TableRow[];
  /** Published tour ranking per player, for sports that are ranked rather than tabled. */
  ranks?: Record<string, { rank: number; asOf: string }>;
  injuries: { id: string; teamId: string; playerName: string; type: string; status: string; reason: string | null }[];
  lineups: { teamId: string; formation: string | null; coach: string | null; confirmed: boolean; starters: string[] }[];
  stats: { teamId: string; stats: Record<string, number> }[];
  h2h: EventDto[];
  homeForm: EventDto[];
  awayForm: EventDto[];
  headlines: { teamId: string; title: string; url: string; source: string; publishedAt: string }[];
  pick: PickDto | null;
}

function formString(team: string, events: EventDto[]): string {
  return [...events]
    .reverse()
    .map((e) => {
      const hs = e.result.homeScore ?? 0;
      const as = e.result.awayScore ?? 0;
      const isHome = e.home?.id === team;
      const mine = isHome ? hs : as;
      const theirs = isHome ? as : hs;
      return mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
    })
    .join('');
}

/**
 * The match page. Everything the models saw and everything they concluded,
 * side by side; after the result, what each model scored.
 */
export function MatchCentre({ event, predictions, table, ranks = {}, injuries, lineups, stats, h2h, homeForm, awayForm, headlines, pick }: MatchCentreProps) {
  const sport = sportDefinition(event.sportKey);
  const home = event.home;
  const away = event.away;
  const ensemble = predictions.filter((p) => p.modelKey === 'ensemble').sort((a, b) => b.version - a.version)[0] ?? null;
  const shown = new Set([...(sport?.models ?? []), 'baseline', 'market']);
  const latestByModel = new Map<string, PredictionDto>();
  for (const p of predictions) if (shown.has(p.modelKey) && !latestByModel.has(p.modelKey)) latestByModel.set(p.modelKey, p);
  const finished = event.status === 'FINISHED';
  const positions = new Map(table.map((row) => [row.teamId, row.position]));
  const tourLabel = event.competition.shortName ?? event.competition.name;
  function standingFor(teamId: string | undefined) {
    if (!teamId) return null;
    const ranked = ranks[teamId];
    if (ranked) {
      return (
        <span className="text-xs text-muted-foreground">
          {tourLabel} #{ranked.rank}
          <span className="sr-only"> as of {formatDate(ranked.asOf)}</span>
        </span>
      );
    }
    if (positions.has(teamId)) return <span className="text-xs text-muted-foreground">{ordinal(positions.get(teamId) as number)} in table</span>;
    return null;
  }
  const headlineStats = (sport?.stats ?? []).filter((s) => s.headline).map((s) => s.key);
  const statDefs = new Map((sport?.stats ?? []).map((s) => [s.key, s]));

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="overflow-hidden">
        <div className="pitch-backdrop absolute inset-0 -z-0 opacity-70" aria-hidden />
        <CardContent className="relative pt-5">
          <p className="text-center text-xs text-muted-foreground">
            <Link href={`/leagues/${event.competition.id}`} className="hover:underline">
              {event.competition.name}
            </Link>
            {event.round ? ` - ${event.round}` : ''} - {formatDateTime(event.startsAt)}
          </p>
          <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <div className="flex flex-col items-center gap-2 text-center">
              {home ? <Crest name={home.name} code={home.code} crestUrl={home.crestUrl} size="lg" /> : null}
              <Link href={home ? `/teams/${home.id}` : '#'} className="font-display text-base font-semibold leading-tight hover:underline sm:text-lg">
                {home?.name ?? 'TBD'}
              </Link>
              {standingFor(home?.id)}
              <FormDots form={home ? formString(home.id, homeForm) : ''} />
            </div>
            <div className="text-center">
              {finished || event.status === 'LIVE' ? (
                <p className="tnum font-display text-4xl font-bold">
                  {event.result.homeScore ?? 0}
                  <span className="text-muted-foreground"> - </span>
                  {event.result.awayScore ?? 0}
                </p>
              ) : ensemble?.score ? (
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Predicted</p>
                  <p className="tnum font-display text-3xl font-bold">
                    {ensemble.score.mostLikely.home}
                    <span className="text-muted-foreground"> - </span>
                    {ensemble.score.mostLikely.away}
                  </p>
                </div>
              ) : (
                <p className="font-display text-2xl font-semibold text-muted-foreground">v</p>
              )}
              <div className="mt-1">
                <StatusChip status={event.status} minute={event.minute} />
              </div>
            </div>
            <div className="flex flex-col items-center gap-2 text-center">
              {away ? <Crest name={away.name} code={away.code} crestUrl={away.crestUrl} size="lg" /> : null}
              <Link href={away ? `/teams/${away.id}` : '#'} className="font-display text-base font-semibold leading-tight hover:underline sm:text-lg">
                {away?.name ?? 'TBD'}
              </Link>
              {standingFor(away?.id)}
              <FormDots form={away ? formString(away.id, awayForm) : ''} />
            </div>
          </div>

          {ensemble ? (
            <div className="mx-auto mt-5 max-w-2xl">
              <ProbBar home={ensemble.probs.HOME ?? 0} draw={sport?.hasDraws ? (ensemble.probs.DRAW ?? 0) : null} away={ensemble.probs.AWAY ?? 0} />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full bg-home" />
                  <span className="truncate">{home?.shortName ?? home?.name ?? sport?.outcomeLabels.HOME ?? 'Home'}</span>
                </span>
                {sport?.hasDraws ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5">
                    <span className="size-2 rounded-full bg-draw" />
                    {sport.outcomeLabels.DRAW}
                  </span>
                ) : null}
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full bg-away" />
                  <span className="truncate">{away?.shortName ?? away?.name ?? sport?.outcomeLabels.AWAY ?? 'Away'}</span>
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-5 text-center text-sm text-muted-foreground">No prediction yet. The engine runs 48 hours before kickoff.</p>
          )}

          {!finished && event.status !== 'CANCELLED' ? (
            <div className="mt-4 flex justify-center">
              <PredictButton eventId={event.id} hasPrediction={Boolean(ensemble)} />
            </div>
          ) : null}

          <div className="mt-3">
            <PickPanel
              eventId={event.id}
              pick={pick}
              outcomes={sport ? outcomesFor(sport) : ['HOME', 'AWAY']}
              labels={(sport?.outcomeLabels ?? {}) as Record<string, string>}
              open={event.status === 'SCHEDULED' && new Date(event.startsAt).getTime() > Date.now()}
              result={finished ? resultWinner(event.result) : null}
            />
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {event.venue ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {event.venue.name}
                {event.venue.city ? `, ${event.venue.city}` : ''}
              </span>
            ) : null}
            {event.referee ? <span>Referee {event.referee}</span> : null}
            {event.weather?.tempC !== undefined ? (
              <span className="inline-flex items-center gap-1">
                <CloudSun className="size-3" />
                {Math.round(event.weather.tempC)}°C
                {event.weather.windKph !== undefined ? `, wind ${Math.round(event.weather.windKph)} km/h` : ''}
                {event.weather.rainProb !== undefined ? `, rain ${Math.round(event.weather.rainProb)}%` : ''}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          {/* Narrative and factors */}
          {ensemble?.narrative || (ensemble?.factors.length ?? 0) > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4 text-primary" />
                  Why
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {ensemble?.narrative ? <p className="text-sm">{ensemble.narrative}</p> : null}
                {ensemble && ensemble.factors.length > 0 ? (
                  <ul className="space-y-1.5">
                    {ensemble.factors.map((f) => (
                      <li key={f.key} className="flex items-center gap-2 text-sm" title={f.note ?? undefined}>
                        <span className="flex w-28 shrink-0 items-center gap-1 truncate text-muted-foreground">
                          {f.source === 'ai' ? <span className="rounded bg-[var(--chart-ai)]/20 px-1 text-[9px] font-bold text-[var(--chart-ai)]">AI</span> : null}
                          <span className="truncate">{f.label}</span>
                        </span>
                        <span className="relative h-2 flex-1 rounded-full bg-muted">
                          <span
                            className={cn('absolute top-0 h-2 rounded-full', f.effect >= 0 ? 'bg-home' : 'bg-away')}
                            style={{
                              left: f.effect >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(f.effect) * 4)}%`,
                              width: `${Math.min(50, Math.abs(f.effect) * 4)}%`,
                            }}
                          />
                        </span>
                        <span className="tnum w-14 text-right text-xs">
                          {f.effect > 0 ? '+' : ''}
                          {f.effect.toFixed(1)} pp
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Stat forecasts or actual stats */}
          {(ensemble?.stats && Object.keys(ensemble.stats).length > 0) || stats.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{finished && stats.length > 0 ? 'Match statistics' : 'Stat forecasts'}</CardTitle>
                <CardDescription className="mt-1">{finished && stats.length > 0 ? 'What happened, with the forecast alongside where one existed.' : 'Expected values with a likely range.'}</CardDescription>
              </CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <tbody>
                    {(ensemble?.stats ? Object.keys(ensemble.stats) : headlineStats).map((key) => {
                      const def = statDefs.get(key);
                      const forecast = ensemble?.stats?.[key];
                      const actualHome = stats.find((s) => s.teamId === home?.id)?.stats[key];
                      const actualAway = stats.find((s) => s.teamId === away?.id)?.stats[key];
                      const fmt = (v: number | undefined) => (v === undefined ? '-' : `${v.toFixed(def?.decimals ?? 1)}${def?.unit ?? ''}`);
                      return (
                        <tr key={key} className="border-t">
                          <td className="tnum py-1.5 text-right">
                            {forecast ? fmt(forecast.home.mean) : ''}
                            {actualHome !== undefined ? <span className={cn('ml-2 font-semibold', forecast && 'text-primary')}>{fmt(actualHome)}</span> : null}
                          </td>
                          <td className="w-40 py-1.5 text-center text-xs text-muted-foreground">{def?.label ?? key}</td>
                          <td className="tnum py-1.5 text-left">
                            {actualAway !== undefined ? <span className={cn('mr-2 font-semibold', forecast && 'text-primary')}>{fmt(actualAway)}</span> : null}
                            {forecast ? fmt(forecast.away.mean) : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ) : null}

          {/* Model breakdown */}
          {latestByModel.size > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Model by model</CardTitle>
                <CardDescription className="mt-1">
                  Tap a model to see how it works. Numbers and bars run{' '}
                  <span className="font-medium text-home">{home?.shortName ?? home?.name ?? 'home'}</span>
                  {sport?.hasDraws ? (
                    <>
                      {', '}
                      <span className="font-medium text-draw">draw</span>
                    </>
                  ) : null}
                  {' then '}
                  <span className="font-medium text-away">{away?.shortName ?? away?.name ?? 'away'}</span>. The ensemble is the one shown elsewhere.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3.5">
                {Array.from(latestByModel.values()).map((p) => {
                  const description = MODEL_DESCRIPTIONS[p.modelKey];
                  const numbers = (
                    <span className="tnum shrink-0 text-xs text-muted-foreground">
                      <span className="text-home">{Math.round((p.probs.HOME ?? 0) * 100)}</span>
                      {sport?.hasDraws ? (
                        <>
                          {' / '}
                          <span className="text-draw">{Math.round((p.probs.DRAW ?? 0) * 100)}</span>
                        </>
                      ) : null}
                      {' / '}
                      <span className="text-away">{Math.round((p.probs.AWAY ?? 0) * 100)}</span>
                    </span>
                  );
                  const bar = <ProbBar home={p.probs.HOME ?? 0} draw={sport?.hasDraws ? (p.probs.DRAW ?? 0) : null} away={p.probs.AWAY ?? 0} compact />;
                  if (!description) {
                    return (
                      <div key={p.modelKey} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate font-medium">{MODEL_LABELS[p.modelKey] ?? p.modelKey}</span>
                          {numbers}
                        </div>
                        {bar}
                      </div>
                    );
                  }
                  return (
                    <details key={p.modelKey} className="group">
                      <summary className="cursor-pointer list-none space-y-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="flex min-w-0 items-center gap-1">
                            <ChevronRight className="size-3.5 shrink-0 self-center text-muted-foreground transition-transform group-open:rotate-90" />
                            <span className="truncate font-medium">{MODEL_LABELS[p.modelKey] ?? p.modelKey}</span>
                          </span>
                          {numbers}
                        </div>
                        {bar}
                      </summary>
                      <p className="mt-1.5 pl-[1.125rem] text-[11px] leading-snug text-muted-foreground">{description}</p>
                    </details>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {/* Head to head */}
          {h2h.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Head to head</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {h2h.map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {/* Lineups */}
          {lineups.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4" />
                  Lineups
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-xs">
                {[home, away].map((team, index) => {
                  const lineup = team ? lineups.find((l) => l.teamId === team.id) : undefined;
                  return (
                    <div key={team?.id ?? `side-${index}`}>
                      <div className="mb-1 font-semibold">
                        {team?.shortName ?? team?.name}
                        {lineup?.formation ? <span className="ml-1 text-muted-foreground">{lineup.formation}</span> : null}
                        {lineup ? <Badge variant={lineup.confirmed ? 'success' : 'secondary'} className="ml-1">{lineup.confirmed ? 'confirmed' : 'expected'}</Badge> : null}
                      </div>
                      <ul className="space-y-0.5 text-muted-foreground">
                        {lineup?.starters.map((s) => <li key={s}>{s}</li>) ?? <li>Not yet announced</li>}
                      </ul>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {/* Headlines the AI read */}
          {headlines.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Newspaper className="size-4" />
                  Headlines
                </CardTitle>
                <CardDescription className="mt-1">What the AI layer read before its assessment.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-xs">
                  {headlines.map((h) => (
                    <li key={h.url} className="flex items-start gap-2">
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                      <span className="min-w-0">
                        <a href={h.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {h.title}
                        </a>
                        <span className="block text-muted-foreground">
                          {[h.teamId === home?.id ? home?.shortName ?? home?.name : away?.shortName ?? away?.name, h.source, formatDate(h.publishedAt)].filter(Boolean).join(' - ')}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {/* Absences */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <HeartPulse className="size-4 text-danger" />
                Absences
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-xs">
              {[home, away].map((team) => (
                <div key={team?.id ?? 'x'}>
                  <p className="mb-1 font-semibold">{team?.shortName ?? team?.name}</p>
                  <ul className="space-y-0.5">
                    {injuries.filter((i) => i.teamId === team?.id).length === 0 ? (
                      <li className="text-muted-foreground">None known</li>
                    ) : (
                      injuries
                        .filter((i) => i.teamId === team?.id)
                        .map((i) => (
                          <li key={i.id} className="flex items-center gap-1">
                            <span className={cn('size-1.5 rounded-full', i.status === 'OUT' || i.status === 'SUSPENDED' ? 'bg-danger' : 'bg-warning')} />
                            {i.playerName}
                            <span className="text-muted-foreground"> - {i.reason ?? i.type}</span>
                          </li>
                        ))
                    )}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Table excerpt */}
          {table.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Table</CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-2">
                <StandingsTable rows={table} compact highlight={[home?.id ?? '', away?.id ?? '']} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
