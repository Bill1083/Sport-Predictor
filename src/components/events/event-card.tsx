import Link from 'next/link';
import { ChevronRight, Sparkles } from 'lucide-react';

import { Crest, ProbBar, StatusChip } from '@/components/events/primitives';
import type { EventDto } from '@/lib/serialize';
import { sportDefinition } from '@/lib/sports/registry';
import { formatTime } from '@/lib/time';
import { cn } from '@/lib/utils';

/**
 * One fixture in a list: crests, kickoff or score, the probability bar and
 * the predicted score when a prediction exists. Server component; the time
 * is formatted in APP_TIMEZONE here rather than in the browser.
 */
export function EventCard({ event, showCompetition = true }: { event: EventDto; showCompetition?: boolean }) {
  const sport = sportDefinition(event.sportKey);
  const finished = event.status === 'FINISHED' || event.status === 'LIVE';
  const p = event.prediction;
  const probs = p?.probs ?? null;
  const home = event.home;
  const away = event.away;

  return (
    <Link
      href={`/events/${event.id}`}
      className="group block rounded-lg border bg-card px-3 py-3 transition-colors hover:border-primary/40 hover:bg-secondary/40 sm:px-4"
    >
      <div className="flex items-center gap-3">
        <div className="w-14 shrink-0 text-center">
          {finished && event.result.homeScore !== undefined ? (
            <p className="tnum font-display text-lg font-semibold leading-tight">
              {event.result.homeScore}
              <span className="text-muted-foreground"> - </span>
              {event.result.awayScore}
            </p>
          ) : (
            <p className="tnum text-sm font-semibold">{formatTime(event.startsAt)}</p>
          )}
          <div className="mt-0.5">
            <StatusChip status={event.status} minute={event.minute} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {home ? <Crest name={home.name} code={home.code} crestUrl={home.crestUrl} size="sm" /> : null}
            <span className={cn('truncate text-sm', probs && probs.HOME >= Math.max(probs.AWAY ?? 0, probs.DRAW ?? 0) && 'font-semibold')}>
              {home?.name ?? 'TBD'}
            </span>
            {p?.score ? <span className="tnum ml-auto text-xs text-muted-foreground">{p.score.expected.home.toFixed(1)}</span> : null}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {away ? <Crest name={away.name} code={away.code} crestUrl={away.crestUrl} size="sm" /> : null}
            <span className={cn('truncate text-sm', probs && (probs.AWAY ?? 0) > Math.max(probs.HOME ?? 0, probs.DRAW ?? 0) && 'font-semibold')}>
              {away?.name ?? 'TBD'}
            </span>
            {p?.score ? <span className="tnum ml-auto text-xs text-muted-foreground">{p.score.expected.away.toFixed(1)}</span> : null}
          </div>
          {probs ? (
            <ProbBar home={probs.HOME ?? 0} draw={sport?.hasDraws ? (probs.DRAW ?? 0) : null} away={probs.AWAY ?? 0} compact className="mt-2" />
          ) : null}
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            {showCompetition ? event.competition.name : null}
            {showCompetition && event.round ? ' - ' : null}
            {event.round}
            {p?.score ? ` - most likely ${p.score.mostLikely.home}-${p.score.mostLikely.away}` : ''}
            {p ? (
              <span className="ml-1 inline-flex items-center gap-0.5 text-primary">
                <Sparkles className="size-3" />
                {Math.round(Math.max(probs?.HOME ?? 0, probs?.DRAW ?? 0, probs?.AWAY ?? 0) * 100)}%
              </span>
            ) : (
              <span className="ml-1 text-muted-foreground/70">no prediction yet</span>
            )}
          </p>
        </div>

        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
