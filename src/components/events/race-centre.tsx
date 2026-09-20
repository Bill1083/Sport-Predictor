import Link from 'next/link';
import { CloudSun, Flag, MapPin } from 'lucide-react';

import { PredictButton } from '@/components/events/predict-button';
import { Crest, StatusChip } from '@/components/events/primitives';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EventDto, PredictionDto } from '@/lib/serialize';
import { formatDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';

function Bar({ value, tone = 'primary' }: { value: number; tone?: 'primary' | 'gold' | 'danger' }) {
  const pct = Math.round(value * 100);
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted sm:block">
        <span className={cn('block h-full rounded-full', tone === 'gold' ? 'bg-gold' : tone === 'danger' ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.max(pct > 0 ? 3 : 0, pct)}%` }} />
      </span>
      <span className={cn('tnum w-9 text-right', pct === 0 && 'text-muted-foreground/60')}>{pct < 1 && value > 0 ? '<1' : pct}%</span>
    </span>
  );
}

/** The race page: the field with win, podium, points and expected finish; the classification once it is run. */
export function RaceCentre({ event, predictions }: { event: EventDto; predictions: PredictionDto[] }) {
  const ensemble = predictions.filter((p) => p.modelKey === 'ensemble').sort((a, b) => b.version - a.version)[0] ?? null;
  const forecasts = ensemble?.score?.entrants ?? [];
  const finished = event.status === 'FINISHED';
  const winnerName = (event.result.extra as { winnerName?: string } | undefined)?.winnerName;
  const byTeam = new Map(forecasts.map((f) => [f.teamId, f]));
  const field = finished ? event.participants : event.participants.slice().sort((a, b) => (byTeam.get(b.team.id)?.win ?? 0) - (byTeam.get(a.team.id)?.win ?? 0) || (a.gridPosition ?? 99) - (b.gridPosition ?? 99));

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden">
        <div className="pitch-backdrop absolute inset-0 -z-0 opacity-70" aria-hidden />
        <CardContent className="relative pt-5 text-center">
          <p className="text-xs text-muted-foreground">
            <Link href={`/leagues/${event.competition.id}`} className="hover:underline">
              {event.competition.name}
            </Link>{' '}
            - {event.season}
          </p>
          <h2 className="mt-2 font-display text-2xl font-semibold">{event.round ?? 'Race'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatDateTime(event.startsAt)}</p>
          <div className="mt-2 flex justify-center">
            <StatusChip status={event.status} />
          </div>
          {finished && winnerName ? (
            <p className="mt-3 flex items-center justify-center gap-2 font-display text-lg font-semibold">
              <Flag className="size-4 text-gold" />
              {winnerName} wins
            </p>
          ) : forecasts.length > 0 ? (
            <p className="mt-3 text-sm">
              Favourite <span className="font-semibold">{forecasts[0].name}</span> at {Math.round(forecasts[0].win * 100)}%
              {forecasts[1] ? `, then ${forecasts[1].name} at ${Math.round(forecasts[1].win * 100)}%` : ''}
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No prediction yet.</p>
          )}
          {!finished && event.status !== 'CANCELLED' ? (
            <div className="mt-4 flex justify-center">
              <PredictButton eventId={event.id} hasPrediction={Boolean(ensemble)} />
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {event.venue ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" />
                {event.venue.name}
                {event.venue.city ? `, ${event.venue.city}` : ''}
              </span>
            ) : null}
            {event.weather?.tempC !== undefined ? (
              <span className="inline-flex items-center gap-1">
                <CloudSun className="size-3" />
                {Math.round(event.weather.tempC)}°C
                {event.weather.rainProb !== undefined ? `, rain ${Math.round(event.weather.rainProb)}%` : ''}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{finished ? 'Classification' : 'The field'}</CardTitle>
          <CardDescription className="mt-1">
            {finished
              ? 'How they finished, with what the model expected.'
              : forecasts.length > 0
                ? `Win, podium and points probabilities from ${ensemble?.score?.entrants ? 'the race simulation' : 'the model'}; expected finish is the mean over the runs.`
                : 'Entrants and grid positions as known so far.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8 pl-4">{finished ? 'Pos' : '#'}</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead className="text-right">Grid</TableHead>
                <TableHead className="text-right">Win</TableHead>
                <TableHead className="text-right">Podium</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Points</TableHead>
                <TableHead className="text-right">xPos</TableHead>
                <TableHead className="hidden pr-4 text-right sm:table-cell">{finished ? 'Status' : 'DNF'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {field.map((p, i) => {
                const f = byTeam.get(p.team.id);
                return (
                  <TableRow key={p.team.id} className={cn(finished && p.finishPosition === 1 && 'bg-gold/10')}>
                    <TableCell className="tnum pl-4 text-muted-foreground">{finished ? (p.finishPosition ?? '-') : i + 1}</TableCell>
                    <TableCell>
                      <Link href={`/teams/${p.team.id}`} className="flex items-center gap-2 hover:underline">
                        <Crest name={p.team.name} code={p.team.code} crestUrl={p.team.crestUrl} size="sm" />
                        <span className="truncate">{p.team.name}</span>
                        {p.team.country ? <span className="hidden text-xs text-muted-foreground md:inline">{p.team.country}</span> : null}
                      </Link>
                    </TableCell>
                    <TableCell className="tnum text-right">{p.gridPosition ?? '-'}</TableCell>
                    <TableCell className="text-right">{f ? <Bar value={f.win} tone="gold" /> : '-'}</TableCell>
                    <TableCell className="text-right">{f ? <Bar value={f.podium} /> : '-'}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{f ? <Bar value={f.points} /> : '-'}</TableCell>
                    <TableCell className="tnum text-right">{f ? f.expectedPosition.toFixed(1) : '-'}</TableCell>
                    <TableCell className="hidden pr-4 text-right text-xs text-muted-foreground sm:table-cell">{finished ? (p.statusNote ?? '') : f ? `${Math.round(f.dnf * 100)}%` : '-'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
