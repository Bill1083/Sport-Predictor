/**
 * API-Sports (API-Football v3 and its siblings). Free tier: 100 requests a
 * day per API with every endpoint, a few recent seasons only. This adapter
 * is the source of fixture statistics (possession, shots, passes...),
 * lineups and injuries for football; the rugby adapter reuses the same
 * request shape against v1.rugby.api-sports.io.
 */

import { env } from '@/lib/env';
import { providerJson } from '@/lib/providers/http';
import type { Capability, CompetitionRef, DateRange, EventRef, EventStatsRef, InjuryRef, LineupRef, SportsDataProvider, StandingRow, TeamRef } from '@/lib/providers/provider';
import type { SportKey } from '@/lib/sports/registry';
import type { EventStatus } from '@/lib/types';

const BASE = 'https://v3.football.api-sports.io';
const DAY_MS = 86_400_000;

/** Countries whose leagues are worth listing; the rest are reachable by id via the curated catalogue. */
const COUNTRIES = new Set(['England', 'Scotland', 'Wales', 'Ireland', 'Spain', 'Italy', 'Germany', 'France', 'Netherlands', 'Portugal', 'Belgium', 'Turkey', 'Greece', 'Switzerland', 'Austria', 'Denmark', 'Sweden', 'Norway', 'Brazil', 'Argentina', 'USA', 'Mexico', 'Japan', 'Australia', 'World', 'Europe']);

interface ApiLeague {
  league: { id: number; name: string; type: string; logo?: string };
  country?: { name?: string; code?: string };
  seasons?: { year: number; current?: boolean; start?: string; end?: string }[];
}

interface ApiTeamRow {
  team: { id: number; name: string; code?: string; country?: string; founded?: number; logo?: string };
  venue?: { id?: number; name?: string; city?: string; capacity?: number };
}

interface ApiFixture {
  fixture: { id: number; date: string; referee?: string | null; status: { short: string; elapsed?: number | null }; venue?: { name?: string | null; city?: string | null } };
  league: { id: number; season: number; round?: string };
  teams: { home: { id: number; name: string; logo?: string }; away: { id: number; name: string; logo?: string } };
  goals: { home: number | null; away: number | null };
}

interface ApiStatRow {
  team: { id: number; name: string };
  statistics: { type: string; value: number | string | null }[];
}

interface ApiLineup {
  team: { id: number; name: string };
  formation?: string | null;
  coach?: { name?: string | null };
  startXI?: { player: { id?: number; name: string; number?: number; pos?: string } }[];
  substitutes?: { player: { id?: number; name: string; number?: number; pos?: string } }[];
}

interface ApiInjury {
  player: { id?: number; name: string; type?: string; reason?: string };
  team: { id: number; name: string };
  fixture?: { id?: number; date?: string };
}

export function mapStatus(short: string): EventStatus {
  switch (short) {
    case 'FT':
    case 'AET':
    case 'PEN':
    case 'AWD':
    case 'WO':
      return 'FINISHED';
    case '1H':
    case 'HT':
    case '2H':
    case 'ET':
    case 'BT':
    case 'P':
    case 'LIVE':
    case 'INT':
      return 'LIVE';
    case 'PST':
    case 'SUSP':
      return 'POSTPONED';
    case 'CANC':
    case 'ABD':
      return 'CANCELLED';
    default:
      return 'SCHEDULED';
  }
}

/** API-Football statistic labels -> ScoreSage stat keys. */
const STAT_KEYS: Record<string, string> = {
  'Ball Possession': 'possession',
  'Total Shots': 'shots',
  'Shots on Goal': 'shotsOnTarget',
  'Total passes': 'passes',
  'Passes %': 'passAccuracy',
  'Corner Kicks': 'corners',
  Fouls: 'fouls',
  'Yellow Cards': 'yellowCards',
  'Red Cards': 'redCards',
  Offsides: 'offsides',
  expected_goals: 'xg',
};

export function mapStatistics(rows: ApiStatRow[], fixtureId: string): EventStatsRef[] {
  return rows.map((row) => {
    const stats: Record<string, number> = {};
    for (const s of row.statistics) {
      const key = STAT_KEYS[s.type];
      if (!key || s.value === null || s.value === undefined) continue;
      const value = typeof s.value === 'number' ? s.value : Number.parseFloat(String(s.value).replace('%', ''));
      if (Number.isFinite(value)) stats[key] = value;
    }
    return { eventExternalId: fixtureId, teamExternalId: String(row.team.id), stats };
  });
}

export function mapFixture(f: ApiFixture): EventRef {
  const status = mapStatus(f.fixture.status.short);
  const hasScore = typeof f.goals.home === 'number' && typeof f.goals.away === 'number';
  return {
    externalId: String(f.fixture.id),
    competitionExternalId: String(f.league.id),
    season: String(f.league.season),
    round: f.league.round,
    startsAt: new Date(f.fixture.date),
    status,
    minute: f.fixture.status.elapsed ?? undefined,
    home: { externalId: String(f.teams.home.id), name: f.teams.home.name, crestUrl: f.teams.home.logo },
    away: { externalId: String(f.teams.away.id), name: f.teams.away.name, crestUrl: f.teams.away.logo },
    venue: f.fixture.venue?.name ? { name: f.fixture.venue.name, city: f.fixture.venue.city ?? undefined } : undefined,
    referee: f.fixture.referee ?? undefined,
    result:
      status !== 'SCHEDULED' && hasScore
        ? { homeScore: f.goals.home as number, awayScore: f.goals.away as number, winner: status === 'FINISHED' ? ((f.goals.home as number) > (f.goals.away as number) ? 'HOME' : (f.goals.home as number) < (f.goals.away as number) ? 'AWAY' : 'DRAW') : undefined }
        : undefined,
  };
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

export class ApiSportsFootballProvider implements SportsDataProvider {
  readonly key = 'api-sports' as const;
  readonly label = 'API-Football';
  readonly sports: SportKey[] = ['football'];
  readonly capabilities: Capability[] = ['competitions', 'teams', 'fixtures', 'results', 'standings', 'lineups', 'injuries', 'eventStats', 'history', 'crests'];

  configured(): boolean {
    return Boolean(env.apiSportsKey);
  }

  private headers(): Record<string, string> {
    return { 'x-apisports-key': env.apiSportsKey ?? '' };
  }

  private async get<T>(path: string, ttlMs: number): Promise<T[]> {
    const data = await providerJson<{ response?: T[]; errors?: unknown }>(this.key, `${BASE}${path}`, { headers: this.headers(), ttlMs });
    if (data.errors && typeof data.errors === 'object' && Object.keys(data.errors as object).length > 0) {
      throw new Error(`API-Football: ${JSON.stringify(data.errors).slice(0, 200)}`);
    }
    return data.response ?? [];
  }

  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    if (sport !== 'football') return [];
    const rows = await this.get<ApiLeague>('/leagues?current=true', 7 * DAY_MS);
    return rows
      .filter((row) => COUNTRIES.has(row.country?.name ?? ''))
      .map((row) => {
        const current = row.seasons?.find((s) => s.current) ?? row.seasons?.[row.seasons.length - 1];
        return {
          externalId: String(row.league.id),
          name: row.league.name,
          country: row.country?.name,
          type: row.league.type === 'Cup' ? 'CUP' : 'LEAGUE',
          currentSeason: current ? String(current.year) : undefined,
          seasons: (row.seasons ?? []).map((s) => String(s.year)).reverse(),
          logoUrl: row.league.logo,
        };
      });
  }

  async listTeams(competition: CompetitionRef, season: string): Promise<TeamRef[]> {
    const rows = await this.get<ApiTeamRow>(`/teams?league=${competition.externalId}&season=${season.slice(0, 4)}`, 7 * DAY_MS);
    return rows.map((row) => ({
      externalId: String(row.team.id),
      name: row.team.name,
      code: row.team.code,
      country: row.team.country,
      founded: row.team.founded,
      crestUrl: row.team.logo,
      venue: row.venue?.name ? { name: row.venue.name, city: row.venue.city, capacity: row.venue.capacity } : undefined,
    }));
  }

  async listEvents(competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]> {
    const rows = await this.get<ApiFixture>(`/fixtures?league=${competition.externalId}&season=${season.slice(0, 4)}&from=${fmt(range.from)}&to=${fmt(range.to)}`, 15 * 60_000);
    return rows.map(mapFixture);
  }

  async listHistory(competition: CompetitionRef, seasons: string[]): Promise<EventRef[]> {
    const out: EventRef[] = [];
    for (const season of seasons) {
      const rows = await this.get<ApiFixture>(`/fixtures?league=${competition.externalId}&season=${season.slice(0, 4)}`, 30 * DAY_MS);
      for (const row of rows) if (mapStatus(row.fixture.status.short) === 'FINISHED') out.push(mapFixture(row));
    }
    return out;
  }

  async getEventStats(event: EventRef): Promise<EventStatsRef[]> {
    const rows = await this.get<ApiStatRow>(`/fixtures/statistics?fixture=${event.externalId}`, 365 * DAY_MS);
    return mapStatistics(rows, event.externalId);
  }

  async getLineups(event: EventRef): Promise<LineupRef[]> {
    const rows = await this.get<ApiLineup>(`/fixtures/lineups?fixture=${event.externalId}`, 30 * 60_000);
    const player = (p: { player: { id?: number; name: string; number?: number; pos?: string } }) => ({ name: p.player.name, number: p.player.number, position: p.player.pos, externalId: p.player.id ? String(p.player.id) : undefined });
    return rows.map((row) => ({
      eventExternalId: event.externalId,
      teamExternalId: String(row.team.id),
      formation: row.formation ?? undefined,
      coach: row.coach?.name ?? undefined,
      starters: (row.startXI ?? []).map(player),
      bench: (row.substitutes ?? []).map(player),
      confirmed: (row.startXI?.length ?? 0) >= 11,
    }));
  }

  async getInjuries(competition: CompetitionRef, season: string): Promise<InjuryRef[]> {
    const rows = await this.get<ApiInjury>(`/injuries?league=${competition.externalId}&season=${season.slice(0, 4)}`, 6 * 3_600_000);
    const now = Date.now();
    return rows
      .filter((row) => !row.fixture?.date || Date.parse(row.fixture.date) >= now - 2 * DAY_MS)
      .map((row) => ({
        teamExternalId: String(row.team.id),
        playerName: row.player.name,
        playerExternalId: row.player.id ? String(row.player.id) : undefined,
        type: row.player.type ?? 'Injury',
        status: /questionable|doubt/i.test(row.player.type ?? '') ? 'DOUBTFUL' : /suspend/i.test(row.player.reason ?? '') ? 'SUSPENDED' : 'OUT',
        reason: row.player.reason,
      }));
  }

  async getStandings(competition: CompetitionRef, season: string): Promise<StandingRow[]> {
    const rows = await this.get<{ league: { standings?: { rank: number; team: { id: number }; all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } }; points: number; form?: string }[][] } }>(
      `/standings?league=${competition.externalId}&season=${season.slice(0, 4)}`,
      3_600_000,
    );
    const table = rows[0]?.league.standings?.[0] ?? [];
    return table.map((row) => ({
      teamExternalId: String(row.team.id),
      position: row.rank,
      played: row.all.played,
      won: row.all.win,
      drawn: row.all.draw,
      lost: row.all.lose,
      scoredFor: row.all.goals.for,
      scoredAgainst: row.all.goals.against,
      points: row.points,
      form: row.form ?? undefined,
    }));
  }
}
