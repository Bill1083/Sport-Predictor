import Link from 'next/link';

import { Crest, FormDots } from '@/components/events/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { TableRow as StandingRow } from '@/lib/standings';
import { cn } from '@/lib/utils';

/**
 * A league table. `zones` marks positions (1-based) with a colour: title,
 * Europe, relegation, so the eye finds the races without reading numbers.
 */
export function StandingsTable({
  rows,
  highlight = [],
  compact = false,
  zones,
  variant = 'league',
}: {
  rows: StandingRow[];
  highlight?: string[];
  compact?: boolean;
  zones?: { top?: number; europe?: number; bottom?: number };
  /** `championship` relabels the columns for drivers: races, wins, podiums, retirements. */
  variant?: 'league' | 'championship';
}) {
  const championship = variant === 'championship';
  const n = rows.length;
  const zoneClass = (position: number) => {
    if (!zones) return '';
    if (zones.top && position <= zones.top) return 'border-l-2 border-l-gold';
    if (zones.europe && position <= zones.europe) return 'border-l-2 border-l-primary';
    if (zones.bottom && position > n - zones.bottom) return 'border-l-2 border-l-danger';
    return 'border-l-2 border-l-transparent';
  };
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8 pl-3">#</TableHead>
          <TableHead>{championship ? 'Driver' : 'Team'}</TableHead>
          <TableHead className="text-right">{championship ? 'R' : 'P'}</TableHead>
          {!compact ? (
            <>
              <TableHead className="text-right">W</TableHead>
              <TableHead className="text-right">{championship ? 'Pod' : 'D'}</TableHead>
              <TableHead className="text-right">{championship ? 'DNF' : 'L'}</TableHead>
              {!championship ? <TableHead className="text-right">F</TableHead> : null}
              {!championship ? <TableHead className="text-right">A</TableHead> : null}
            </>
          ) : null}
          {!championship ? <TableHead className="text-right">GD</TableHead> : null}
          <TableHead className="text-right">Pts</TableHead>
          {!compact ? <TableHead className="hidden sm:table-cell">Form</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.teamId} className={cn(highlight.includes(row.teamId) && 'bg-primary/10')}>
            <TableCell className={cn('tnum pl-3 text-muted-foreground', zoneClass(row.position))}>{row.position}</TableCell>
            <TableCell>
              <Link href={`/teams/${row.teamId}`} className="flex items-center gap-2 hover:underline">
                <Crest name={row.team.name} code={row.team.code} crestUrl={row.team.crestUrl} size="sm" />
                <span className="truncate">{compact ? (row.team.shortName ?? row.team.name) : row.team.name}</span>
              </Link>
            </TableCell>
            <TableCell className="tnum text-right">{row.played}</TableCell>
            {!compact ? (
              <>
                <TableCell className="tnum text-right">{row.won}</TableCell>
                <TableCell className="tnum text-right">{row.drawn}</TableCell>
                <TableCell className="tnum text-right">{row.lost}</TableCell>
                {!championship ? <TableCell className="tnum text-right">{row.scoredFor}</TableCell> : null}
                {!championship ? <TableCell className="tnum text-right">{row.scoredAgainst}</TableCell> : null}
              </>
            ) : null}
            {!championship ? (
              <TableCell className="tnum text-right">
                {row.scoredFor - row.scoredAgainst > 0 ? '+' : ''}
                {row.scoredFor - row.scoredAgainst}
              </TableCell>
            ) : null}
            <TableCell className="tnum text-right font-semibold">{row.points}</TableCell>
            {!compact ? (
              <TableCell className="hidden sm:table-cell">
                <FormDots form={row.form} />
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
