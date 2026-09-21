import Link from 'next/link';

import { Crest } from '@/components/events/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { RankingRow } from '@/lib/standings';
import { cn } from '@/lib/utils';

/**
 * The tour's published ranking, next to what each player has done in the
 * events we hold. A player we have never seen ranked shows a dash rather
 * than an invented position.
 */
export function RankingsTable({ rows, highlight = [] }: { rows: RankingRow[]; highlight?: string[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10 pl-4">Rank</TableHead>
          <TableHead>Player</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Points</TableHead>
          <TableHead className="text-right">P</TableHead>
          <TableHead className="pr-4 text-right">W</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.teamId} className={cn(highlight.includes(row.teamId) && 'bg-primary/10')}>
            <TableCell className="tnum pl-4 text-muted-foreground">{row.rank ?? '-'}</TableCell>
            <TableCell>
              <Link href={`/teams/${row.teamId}`} className="flex items-center gap-2 hover:underline">
                <Crest name={row.team.name} code={row.team.code} crestUrl={row.team.crestUrl} size="sm" />
                <span className="truncate">{row.team.name}</span>
              </Link>
            </TableCell>
            <TableCell className="tnum hidden text-right sm:table-cell">{row.points !== null ? row.points.toLocaleString('en-GB') : '-'}</TableCell>
            <TableCell className="tnum text-right">{row.played}</TableCell>
            <TableCell className="tnum pr-4 text-right">{row.won}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
