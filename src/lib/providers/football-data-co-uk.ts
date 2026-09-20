/**
 * Football-Data.co.uk: free CSVs per league-season back to 1993 with
 * results, shots, shots on target, corners, fouls, cards and the referee.
 * The current season's file is updated after every round, so it doubles
 * as a results feed. No key, no rate limit worth speaking of.
 */

import Papa from 'papaparse';

import { providerFetch } from '@/lib/providers/http';
import type { Capability, CompetitionRef, DateRange, EventRef, EventStatsRef, SportsDataProvider } from '@/lib/providers/provider';
import { curatedFor } from '@/lib/sports/competitions';
import type { SportKey } from '@/lib/sports/registry';

const BASE = 'https://www.football-data.co.uk/mmz4281';
const DAY_MS = 86_400_000;

export interface CsvRow {
  Div?: string;
  Date?: string;
  Time?: string;
  HomeTeam?: string;
  AwayTeam?: string;
  FTHG?: string;
  FTAG?: string;
  HS?: string;
  AS?: string;
  HST?: string;
  AST?: string;
  HC?: string;
  AC?: string;
  HF?: string;
  AF?: string;
  HY?: string;
  AY?: string;
  HR?: string;
  AR?: string;
  Referee?: string;
}

/** "2026" -> "2627" */
export function seasonCode(startYear: string): string {
  const y = Number(startYear.slice(0, 4));
  return `${String(y).slice(2)}${String(y + 1).slice(2)}`;
}

/** dd/mm/yy or dd/mm/yyyy plus optional HH:MM -> UTC instant (times are UK local; close enough for a kickoff key). */
export function parseDate(date: string, time?: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(date.trim());
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const [hh, mm] = time && /^\d{1,2}:\d{2}/.test(time) ? time.split(':').map(Number) : [15, 0];
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1]), hh, mm));
}

function num(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function parseCsv(text: string): CsvRow[] {
  const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim() });
  return parsed.data.filter((row) => row.HomeTeam && row.AwayTeam && row.Date);
}

function teamId(name: string): string {
  return `fdcouk:${name.trim()}`;
}

export function rowToEvent(row: CsvRow, competitionExternalId: string, season: string): EventRef | null {
  const startsAt = parseDate(row.Date ?? '', row.Time);
  if (!startsAt || !row.HomeTeam || !row.AwayTeam) return null;
  const hs = num(row.FTHG);
  const as = num(row.FTAG);
  const finished = hs !== undefined && as !== undefined;
  return {
    externalId: `${competitionExternalId}:${season}:${row.Date}:${row.HomeTeam}:${row.AwayTeam}`,
    competitionExternalId,
    season,
    startsAt,
    status: finished ? 'FINISHED' : 'SCHEDULED',
    home: { externalId: teamId(row.HomeTeam), name: row.HomeTeam.trim() },
    away: { externalId: teamId(row.AwayTeam), name: row.AwayTeam.trim() },
    referee: row.Referee?.trim() || undefined,
    result: finished ? { homeScore: hs, awayScore: as, winner: hs > as ? 'HOME' : hs < as ? 'AWAY' : 'DRAW' } : undefined,
  };
}

export function rowToStats(row: CsvRow, event: EventRef): EventStatsRef[] {
  const side = (goals: string | undefined, shots: string | undefined, sot: string | undefined, corners: string | undefined, fouls: string | undefined, yellows: string | undefined, reds: string | undefined) => {
    const stats: Record<string, number> = {};
    const put = (key: string, value: string | undefined) => {
      const n = num(value);
      if (n !== undefined) stats[key] = n;
    };
    put('goals', goals);
    put('shots', shots);
    put('shotsOnTarget', sot);
    put('corners', corners);
    put('fouls', fouls);
    put('yellowCards', yellows);
    put('redCards', reds);
    return stats;
  };
  const home = side(row.FTHG, row.HS, row.HST, row.HC, row.HF, row.HY, row.HR);
  const away = side(row.FTAG, row.AS, row.AST, row.AC, row.AF, row.AY, row.AR);
  if (Object.keys(home).length <= 1) return [];
  return [
    { eventExternalId: event.externalId, teamExternalId: event.home.externalId, stats: home },
    { eventExternalId: event.externalId, teamExternalId: event.away.externalId, stats: away },
  ];
}

export class FootballDataCoUkProvider implements SportsDataProvider {
  readonly key = 'football-data-co-uk' as const;
  readonly label = 'Football-Data.co.uk';
  readonly sports: SportKey[] = ['football'];
  readonly capabilities: Capability[] = ['competitions', 'fixtures', 'results', 'history', 'eventStats'];
  private cache = new Map<string, CsvRow[]>();

  configured(): boolean {
    return true;
  }

  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    if (sport !== 'football') return [];
    return curatedFor('football')
      .filter((c) => c.ids['football-data-co-uk'])
      .map((c) => ({ externalId: c.ids['football-data-co-uk'] as string, name: c.name, country: c.country, type: c.type, tier: c.tier }));
  }

  async listTeams(): Promise<never[]> {
    return [];
  }

  private async rows(division: string, season: string, ttlMs: number): Promise<CsvRow[]> {
    const url = `${BASE}/${seasonCode(season)}/${division}.csv`;
    const memo = `${url}:${ttlMs}`;
    if (this.cache.has(memo)) return this.cache.get(memo) as CsvRow[];
    const response = await providerFetch(this.key, url, { ttlMs, emptyStatuses: [404] });
    const rows = response.status === 404 ? [] : parseCsv(response.body);
    this.cache.set(memo, rows);
    return rows;
  }

  async listEvents(competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]> {
    const rows = await this.rows(competition.externalId, season, 6 * 3_600_000);
    return rows
      .map((row) => rowToEvent(row, competition.externalId, season.slice(0, 4)))
      .filter((e): e is EventRef => e !== null && e.startsAt >= range.from && e.startsAt <= range.to);
  }

  async listHistory(competition: CompetitionRef, seasons: string[]): Promise<EventRef[]> {
    const out: EventRef[] = [];
    for (const season of seasons) {
      const rows = await this.rows(competition.externalId, season, 60 * DAY_MS);
      for (const row of rows) {
        const e = rowToEvent(row, competition.externalId, season.slice(0, 4));
        if (e?.status === 'FINISHED') out.push(e);
      }
    }
    return out;
  }

  async getEventStats(event: EventRef): Promise<EventStatsRef[]> {
    const [division, season, date, home, away] = event.externalId.split(':');
    const rows = await this.rows(division, season, 60 * DAY_MS);
    const row = rows.find((r) => r.Date === date && r.HomeTeam === home && r.AwayTeam === away);
    return row ? rowToStats(row, event) : [];
  }
}
