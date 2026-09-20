/**
 * League tables computed from finished events, so they work for any provider
 * and any point in time (the backtest asks for the table as it stood before
 * a matchday).
 */

import type { Event, Team } from '@prisma/client';

import { prisma, withDatabase } from '@/lib/prisma';
import { parseResult } from '@/lib/types';

export interface TableRow {
  teamId: string;
  team: Pick<Team, 'id' | 'name' | 'shortName' | 'code' | 'crestUrl'>;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scoredFor: number;
  scoredAgainst: number;
  points: number;
  /** Last five results, oldest first: W / D / L. */
  form: string;
}

export interface PointsRule {
  win: number;
  draw: number;
  loss: number;
}

const DEFAULT_POINTS: PointsRule = { win: 3, draw: 1, loss: 0 };

/** Pure: build a table from events that already carry their teams. */
export function buildTable(
  events: (Pick<Event, 'homeTeamId' | 'awayTeamId' | 'resultJson' | 'status' | 'startsAt'> & {
    homeTeam: TableRow['team'] | null;
    awayTeam: TableRow['team'] | null;
  })[],
  points: PointsRule = DEFAULT_POINTS,
): TableRow[] {
  const rows = new Map<string, TableRow>();
  const formLog = new Map<string, string[]>();
  const ensure = (team: TableRow['team']) => {
    let row = rows.get(team.id);
    if (!row) {
      row = { teamId: team.id, team, position: 0, played: 0, won: 0, drawn: 0, lost: 0, scoredFor: 0, scoredAgainst: 0, points: 0, form: '' };
      rows.set(team.id, row);
      formLog.set(team.id, []);
    }
    return row;
  };
  const sorted = [...events].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  for (const event of sorted) {
    if (!event.homeTeam || !event.awayTeam) continue;
    const home = ensure(event.homeTeam);
    const away = ensure(event.awayTeam);
    if (event.status !== 'FINISHED') continue;
    const result = parseResult(event.resultJson);
    if (typeof result.homeScore !== 'number' || typeof result.awayScore !== 'number') continue;
    home.played += 1;
    away.played += 1;
    home.scoredFor += result.homeScore;
    home.scoredAgainst += result.awayScore;
    away.scoredFor += result.awayScore;
    away.scoredAgainst += result.homeScore;
    if (result.homeScore > result.awayScore) {
      home.won += 1;
      away.lost += 1;
      home.points += points.win;
      away.points += points.loss;
      formLog.get(home.teamId)?.push('W');
      formLog.get(away.teamId)?.push('L');
    } else if (result.homeScore < result.awayScore) {
      away.won += 1;
      home.lost += 1;
      away.points += points.win;
      home.points += points.loss;
      formLog.get(home.teamId)?.push('L');
      formLog.get(away.teamId)?.push('W');
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.points += points.draw;
      away.points += points.draw;
      formLog.get(home.teamId)?.push('D');
      formLog.get(away.teamId)?.push('D');
    }
  }
  const table = Array.from(rows.values()).sort(
    (a, b) =>
      b.points - a.points ||
      b.scoredFor - b.scoredAgainst - (a.scoredFor - a.scoredAgainst) ||
      b.scoredFor - a.scoredFor ||
      a.team.name.localeCompare(b.team.name),
  );
  table.forEach((row, index) => {
    row.position = index + 1;
    row.form = (formLog.get(row.teamId) ?? []).slice(-5).join('');
  });
  return table;
}

/** The table for a competition season as of `asOf` (default: now). */
export async function competitionTable(competitionId: string, season: string, asOf?: Date): Promise<TableRow[]> {
  const events = await withDatabase(() =>
    prisma.event.findMany({
      where: { competitionId, season, ...(asOf ? { startsAt: { lt: asOf } } : {}) },
      include: {
        homeTeam: { select: { id: true, name: true, shortName: true, code: true, crestUrl: true } },
        awayTeam: { select: { id: true, name: true, shortName: true, code: true, crestUrl: true } },
      },
    }),
  );
  return events.ok ? buildTable(events.data) : [];
}

/**
 * A drivers' championship for multi-entrant competitions: points from each
 * race's classification. In the shared row shape wins sit in `won`, podiums
 * in `drawn`, retirements in `lost` and points in both `scoredFor` and
 * `points`; form shows W for a win, D for a points finish, L otherwise.
 */
export async function championshipTable(competitionId: string, season: string, asOf?: Date): Promise<TableRow[]> {
  const events = await withDatabase(() =>
    prisma.event.findMany({
      where: { competitionId, season, status: 'FINISHED', ...(asOf ? { startsAt: { lt: asOf } } : {}) },
      include: { participants: { where: { side: 'ENTRANT' }, include: { team: { select: { id: true, name: true, shortName: true, code: true, crestUrl: true } } } } },
      orderBy: { startsAt: 'asc' },
    }),
  );
  if (!events.ok) return [];
  const rows = new Map<string, TableRow>();
  const formLog = new Map<string, string[]>();
  for (const event of events.data) {
    for (const p of event.participants) {
      let row = rows.get(p.teamId);
      if (!row) {
        row = { teamId: p.teamId, team: p.team, position: 0, played: 0, won: 0, drawn: 0, lost: 0, scoredFor: 0, scoredAgainst: 0, points: 0, form: '' };
        rows.set(p.teamId, row);
        formLog.set(p.teamId, []);
      }
      row.played += 1;
      const pts = p.score ?? 0;
      row.points += pts;
      row.scoredFor += pts;
      const finished = p.statusNote === null || p.statusNote === 'Finished' || /^\+\d+ Laps?$/.test(p.statusNote);
      if (p.finishPosition === 1) row.won += 1;
      if (p.finishPosition !== null && p.finishPosition <= 3) row.drawn += 1;
      if (!finished) row.lost += 1;
      formLog.get(p.teamId)?.push(p.finishPosition === 1 ? 'W' : pts > 0 ? 'D' : 'L');
    }
  }
  const table = Array.from(rows.values()).sort((a, b) => b.points - a.points || b.won - a.won || b.drawn - a.drawn || a.team.name.localeCompare(b.team.name));
  table.forEach((row, index) => {
    row.position = index + 1;
    row.form = (formLog.get(row.teamId) ?? []).slice(-5).join('');
  });
  return table;
}
