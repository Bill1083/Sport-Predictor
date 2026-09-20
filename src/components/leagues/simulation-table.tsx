import Link from 'next/link';

import { Crest } from '@/components/events/primitives';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Simulation } from '@/lib/engine/simulate';
import { cn } from '@/lib/utils';

function Pct({ value, tone }: { value: number; tone: 'gold' | 'primary' | 'danger' }) {
  const pct = Math.round(value * 100);
  const colour = tone === 'gold' ? 'bg-gold' : tone === 'primary' ? 'bg-primary' : 'bg-danger';
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
        <span className={cn('block h-full rounded-full', colour)} style={{ width: `${Math.max(pct > 0 ? 3 : 0, pct)}%` }} />
      </span>
      <span className={cn('tnum w-9 text-right', pct === 0 && 'text-muted-foreground/60')}>{pct < 1 && value > 0 ? '<1' : pct}%</span>
    </span>
  );
}

/** The Monte Carlo finish: expected points and position, title, top-zone and drop probabilities. */
export function SimulationTable({ simulation }: { simulation: Simulation }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8 pl-3">#</TableHead>
          <TableHead>Team</TableHead>
          <TableHead className="text-right">Pts</TableHead>
          <TableHead className="text-right">xPts</TableHead>
          <TableHead className="text-right">xPos</TableHead>
          <TableHead className="text-right">Title</TableHead>
          <TableHead className="text-right">Top {simulation.zones.top}</TableHead>
          <TableHead className="pr-3 text-right">Bottom {simulation.zones.bottom}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {simulation.teams.map((team, i) => (
          <TableRow key={team.teamId}>
            <TableCell className="tnum pl-3 text-muted-foreground">{i + 1}</TableCell>
            <TableCell>
              <Link href={`/teams/${team.teamId}`} className="flex items-center gap-2 hover:underline">
                <Crest name={team.name} crestUrl={team.crestUrl} size="sm" />
                <span className="truncate">{team.shortName ?? team.name}</span>
              </Link>
            </TableCell>
            <TableCell className="tnum text-right">{team.currentPoints}</TableCell>
            <TableCell className="tnum text-right font-semibold">{team.expectedPoints.toFixed(1)}</TableCell>
            <TableCell className="tnum text-right">{team.expectedPosition.toFixed(1)}</TableCell>
            <TableCell className="text-right">
              <Pct value={team.title} tone="gold" />
            </TableCell>
            <TableCell className="text-right">
              <Pct value={team.top} tone="primary" />
            </TableCell>
            <TableCell className="pr-3 text-right">
              <Pct value={team.bottom} tone="danger" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
