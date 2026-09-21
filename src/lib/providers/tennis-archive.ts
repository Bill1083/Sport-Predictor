/**
 * Jeff Sackmann's tennis match archive, served from a community mirror on
 * GitHub (CC BY-NC-SA). One CSV per tour and year with every completed
 * match, the score, the surface and serve statistics for both players.
 * There is no schedule here: the archive gives history and stats, the ESPN
 * scoreboard gives upcoming matches and live results.
 *
 * Players are stored as Team rows of kind PLAYER. The archive only knows a
 * tournament's start date, so each match is dated by round: the first round
 * on day one, the final on day six.
 */

import Papa from 'papaparse';

import { providerFetch } from '@/lib/providers/http';
import type { Capability, CompetitionRef, DateRange, EventRef, EventStatsRef, SportsDataProvider, TeamRef } from '@/lib/providers/provider';
import type { Outcome, SportKey } from '@/lib/sports/registry';

const BASE = 'https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main';
const DAY_MS = 86_400_000;

export const TOURS: CompetitionRef[] = [
  { externalId: 'atp', name: 'ATP Tour', shortName: 'ATP', country: 'World', type: 'TOUR', tier: 1 },
  { externalId: 'wta', name: 'WTA Tour', shortName: 'WTA', country: 'World', type: 'TOUR', tier: 1 },
];

export type ArchiveRow = Record<string, string>;

export interface RankingRef {
  /** The archive's player id, which is also this provider's team externalId. */
  externalId: string;
  name: string;
  rank: number;
  points: number | null;
  /** The date the tour published this list, not the date we read it. */
  asOf: Date;
}

/** "20260608" -> a UTC date. */
export function archiveDate(value: string): Date | null {
  if (!/^\d{8}$/.test(value)) return null;
  return new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8))));
}

/**
 * The rankings file holds several weekly lists; only the newest is current.
 * It carries player ids and no names, so names come from the match rows we
 * have already downloaded for the same tour.
 */
export function latestRankings(rows: ArchiveRow[], names: Map<string, string>): RankingRef[] {
  let newest = '';
  for (const row of rows) if (row.ranking_date && row.ranking_date > newest) newest = row.ranking_date;
  const asOf = archiveDate(newest);
  if (!asOf) return [];
  const out: RankingRef[] = [];
  for (const row of rows) {
    if (row.ranking_date !== newest) continue;
    const rank = num(row.rank);
    const id = row.player;
    if (!rank || !id) continue;
    const name = names.get(id);
    if (!name) continue;
    out.push({ externalId: id, name, rank, points: num(row.points) ?? null, asOf });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

const ROUND_DAY: Record<string, number> = { R128: 0, R64: 1, R32: 2, R16: 3, QF: 4, SF: 5, F: 6, RR: 1, BR: 6, ER: 0, Q1: -3, Q2: -2, Q3: -1 };

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** "6-3 3-6 7-6(4)" -> sets and games for the winner and loser; retirements count what was played. */
export function parseScore(score: string): { sets: [number, number]; games: [number, number]; retired: boolean } {
  const retired = /RET|W\/O|DEF|Walkover/i.test(score);
  let sets: [number, number] = [0, 0];
  let games: [number, number] = [0, 0];
  for (const token of score.split(/\s+/)) {
    const m = /^(\d+)-(\d+)/.exec(token);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    games = [games[0] + a, games[1] + b];
    // Only a completed set counts: to six with two clear, or a seventh game after a tiebreak.
    const complete = Math.max(a, b) >= 6 && (Math.abs(a - b) >= 2 || Math.max(a, b) >= 7);
    if (!complete) continue;
    if (a > b) sets = [sets[0] + 1, sets[1]];
    else sets = [sets[0], sets[1] + 1];
  }
  return { sets, games, retired };
}

/** Deterministic sides so every provider files the same pairing the same way round. */
export function sidesFor(a: string, b: string): boolean {
  return a.localeCompare(b, 'en') <= 0;
}

export function playerRef(row: ArchiveRow, who: 'winner' | 'loser'): TeamRef {
  const name = row[`${who}_name`] ?? '';
  return { externalId: row[`${who}_id`] || name, name, shortName: name.split(' ').slice(-1)[0], country: row[`${who}_ioc`] || undefined, kind: 'PLAYER' };
}

export function rowToEvent(row: ArchiveRow, tour: string): EventRef | null {
  const date = row.tourney_date;
  if (!date || date.length !== 8 || !row.winner_name || !row.loser_name) return null;
  const start = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), 12);
  const offset = ROUND_DAY[row.round] ?? 2;
  const startsAt = new Date(start + offset * DAY_MS);
  const winner = playerRef(row, 'winner');
  const loser = playerRef(row, 'loser');
  const winnerHome = sidesFor(winner.name, loser.name);
  const { sets, games, retired } = parseScore(row.score ?? '');
  const bestOf = num(row.best_of) ?? 3;
  return {
    externalId: `${row.tourney_id}:${row.match_num}`,
    competitionExternalId: tour,
    season: date.slice(0, 4),
    round: `${row.tourney_name} ${row.round}`,
    stage: row.tourney_level,
    startsAt,
    status: 'FINISHED',
    home: winnerHome ? winner : loser,
    away: winnerHome ? loser : winner,
    format: `${row.surface || 'Hard'} BO${bestOf}`,
    result: {
      homeScore: winnerHome ? sets[0] : sets[1],
      awayScore: winnerHome ? sets[1] : sets[0],
      winner: (winnerHome ? 'HOME' : 'AWAY') as Outcome,
      extra: { games: winnerHome ? games : [games[1], games[0]], retired, minutes: num(row.minutes) ?? null, score: row.score },
    },
  };
}

function serveStats(row: ArchiveRow, p: 'w' | 'l', sets: number, games: number): Record<string, number> {
  const stats: Record<string, number> = { sets, games };
  const aces = num(row[`${p}_ace`]);
  const df = num(row[`${p}_df`]);
  const svpt = num(row[`${p}_svpt`]);
  const firstIn = num(row[`${p}_1stIn`]);
  const bpFaced = num(row[`${p === 'w' ? 'l' : 'w'}_bpFaced`]);
  const bpSaved = num(row[`${p === 'w' ? 'l' : 'w'}_bpSaved`]);
  if (aces !== undefined) stats.aces = aces;
  if (df !== undefined) stats.doubleFaults = df;
  if (svpt && firstIn !== undefined) stats.firstServePct = Math.round((firstIn / svpt) * 1000) / 10;
  if (bpFaced !== undefined && bpSaved !== undefined) stats.breakPointsWon = bpFaced - bpSaved;
  return stats;
}

export function rowToStats(row: ArchiveRow, event: EventRef): EventStatsRef[] {
  const { sets, games } = parseScore(row.score ?? '');
  const winner = playerRef(row, 'winner');
  const loser = playerRef(row, 'loser');
  return [
    { eventExternalId: event.externalId, teamExternalId: winner.externalId, stats: serveStats(row, 'w', sets[0], games[0]) },
    { eventExternalId: event.externalId, teamExternalId: loser.externalId, stats: serveStats(row, 'l', sets[1], games[1]) },
  ];
}

export class TennisArchiveProvider implements SportsDataProvider {
  readonly key = 'tennis-archive' as const;
  readonly label = 'Tennis archive (Sackmann mirror)';
  readonly sports: SportKey[] = ['tennis'];
  readonly capabilities: Capability[] = ['competitions', 'history', 'eventStats'];
  private cache = new Map<string, ArchiveRow[]>();

  configured(): boolean {
    return true;
  }

  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    if (sport !== 'tennis') return [];
    const year = new Date().getUTCFullYear();
    return TOURS.map((t) => ({ ...t, currentSeason: String(year), seasons: Array.from({ length: 6 }, (_, i) => String(year - i)) }));
  }

  async listTeams(): Promise<TeamRef[]> {
    return [];
  }

  private async rows(tour: string, year: string, ttlMs: number): Promise<ArchiveRow[]> {
    const url = `${BASE}/${tour}/${tour}_matches_${year}.csv`;
    const memo = `${url}:${ttlMs}`;
    if (this.cache.has(memo)) return this.cache.get(memo) as ArchiveRow[];
    const response = await providerFetch(this.key, url, { ttlMs, timeoutMs: 30_000, emptyStatuses: [404] });
    const rows = response.status === 404 ? [] : (Papa.parse<ArchiveRow>(response.body, { header: true, skipEmptyLines: true }).data ?? []);
    this.cache.set(memo, rows);
    return rows;
  }

  async listEvents(competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]> {
    const rows = await this.rows(competition.externalId, season.slice(0, 4), 6 * 3_600_000);
    return rows.map((r) => rowToEvent(r, competition.externalId)).filter((e): e is EventRef => e !== null && e.startsAt >= range.from && e.startsAt <= range.to);
  }

  async listHistory(competition: CompetitionRef, seasons: string[]): Promise<EventRef[]> {
    const out: EventRef[] = [];
    const thisYear = String(new Date().getUTCFullYear());
    for (const season of seasons) {
      const year = season.slice(0, 4);
      const rows = await this.rows(competition.externalId, year, year === thisYear ? 6 * 3_600_000 : 60 * DAY_MS);
      for (const row of rows) {
        const e = rowToEvent(row, competition.externalId);
        if (e) out.push(e);
      }
    }
    return out;
  }

  /**
   * The tour's current ranking list. The mirror refreshes in batches, so this
   * can trail the live list by a few weeks; `asOf` says when it was published
   * and the UI shows that date rather than implying it is live.
   */
  async listRankings(tour: string, now = new Date()): Promise<RankingRef[]> {
    const year = now.getUTCFullYear();
    const names = new Map<string, string>();
    for (const y of [year, year - 1]) {
      for (const row of await this.rows(tour, String(y), 6 * 3_600_000)) {
        if (row.winner_id && row.winner_name) names.set(row.winner_id, row.winner_name);
        if (row.loser_id && row.loser_name) names.set(row.loser_id, row.loser_name);
      }
    }
    const url = `${BASE}/${tour}/${tour}_rankings_current.csv`;
    const response = await providerFetch(this.key, url, { ttlMs: 2 * DAY_MS, timeoutMs: 40_000, emptyStatuses: [404] });
    if (response.status === 404) return [];
    const rows = Papa.parse<ArchiveRow>(response.body, { header: true, skipEmptyLines: true }).data ?? [];
    return latestRankings(rows, names);
  }

  async getEventStats(event: EventRef): Promise<EventStatsRef[]> {
    const [tourneyId, matchNum] = event.externalId.split(':');
    const rows = await this.rows(event.competitionExternalId, event.season.slice(0, 4), 60 * DAY_MS);
    const row = rows.find((r) => r.tourney_id === tourneyId && r.match_num === matchNum);
    return row ? rowToStats(row, event) : [];
  }
}
