/**
 * API-Sports Rugby (v1.rugby.api-sports.io): union and league competitions
 * worldwide with fixtures, results and standings; 100 requests a day on the
 * free plan, counted separately from API-Football. Union and league share
 * the feed, so the competition list is tagged by name.
 */

import { env } from '@/lib/env';
import { providerJson } from '@/lib/providers/http';
import type { Capability, CompetitionRef, DateRange, EventRef, SportsDataProvider, StandingRow, TeamRef } from '@/lib/providers/provider';
import type { SportKey } from '@/lib/sports/registry';
import type { EventStatus } from '@/lib/types';

const BASE = 'https://v1.rugby.api-sports.io';
const DAY_MS = 86_400_000;

interface RugbyLeague {
  id: number;
  name: string;
  type?: string;
  logo?: string;
  country?: { name?: string };
  seasons?: { season: number; current?: boolean }[];
}

interface RugbyTeam {
  id: number;
  name: string;
  logo?: string;
  country?: { name?: string };
  founded?: number;
  arena?: { name?: string; location?: string; capacity?: number };
}

interface RugbyGame {
  id: number;
  date: string;
  timestamp?: number;
  week?: string | number | null;
  status: { long?: string; short: string };
  league: { id: number; season: number };
  teams: { home: { id: number; name: string; logo?: string }; away: { id: number; name: string; logo?: string } };
  scores: { home: number | null; away: number | null };
}

/** Rugby league competitions are the ones with these words; everything else is union. */
const LEAGUE_CODE = /\b(NRL|Super League|Rugby League|State of Origin|Championship \(RL\)|Challenge Cup)\b/i;

export function codeFor(name: string): SportKey {
  return LEAGUE_CODE.test(name) ? 'rugby_league' : 'rugby_union';
}

export function mapStatus(short: string): EventStatus {
  switch (short) {
    case 'FT':
    case 'AET':
    case 'AWD':
    case 'WO':
      return 'FINISHED';
    case '1H':
    case 'HT':
    case '2H':
    case 'ET':
    case 'BT':
    case 'LIVE':
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

export function mapGame(g: RugbyGame): EventRef {
  const status = mapStatus(g.status.short);
  const hasScore = typeof g.scores.home === 'number' && typeof g.scores.away === 'number';
  const hs = g.scores.home as number;
  const as = g.scores.away as number;
  return {
    externalId: String(g.id),
    competitionExternalId: String(g.league.id),
    season: String(g.league.season),
    round: g.week ? `Round ${g.week}` : undefined,
    startsAt: g.timestamp ? new Date(g.timestamp * 1000) : new Date(g.date),
    status,
    home: { externalId: String(g.teams.home.id), name: g.teams.home.name, crestUrl: g.teams.home.logo },
    away: { externalId: String(g.teams.away.id), name: g.teams.away.name, crestUrl: g.teams.away.logo },
    result: status !== 'SCHEDULED' && hasScore ? { homeScore: hs, awayScore: as, winner: status === 'FINISHED' ? (hs > as ? 'HOME' : hs < as ? 'AWAY' : 'DRAW') : undefined } : undefined,
  };
}

export class ApiSportsRugbyProvider implements SportsDataProvider {
  readonly key = 'api-sports-rugby' as const;
  readonly label = 'API-Rugby';
  readonly sports: SportKey[] = ['rugby_union', 'rugby_league'];
  readonly capabilities: Capability[] = ['competitions', 'teams', 'fixtures', 'results', 'standings', 'history', 'crests'];

  configured(): boolean {
    return Boolean(env.apiSportsKey);
  }

  private async get<T>(path: string, ttlMs: number): Promise<T[]> {
    const data = await providerJson<{ response?: T[]; errors?: unknown }>(this.key, `${BASE}${path}`, { headers: { 'x-apisports-key': env.apiSportsKey ?? '' }, ttlMs });
    if (data.errors && typeof data.errors === 'object' && Object.keys(data.errors as object).length > 0) {
      throw new Error(`API-Rugby: ${JSON.stringify(data.errors).slice(0, 200)}`);
    }
    return data.response ?? [];
  }

  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    if (sport !== 'rugby_union' && sport !== 'rugby_league') return [];
    const rows = await this.get<RugbyLeague>('/leagues', 7 * DAY_MS);
    return rows
      .filter((row) => codeFor(row.name) === sport)
      .map((row) => {
        const current = row.seasons?.find((s) => s.current) ?? row.seasons?.[row.seasons.length - 1];
        return {
          externalId: String(row.id),
          name: row.name,
          country: row.country?.name,
          type: /cup|championship|world|nations/i.test(row.name) ? 'CUP' : 'LEAGUE',
          currentSeason: current ? String(current.season) : undefined,
          seasons: (row.seasons ?? []).map((s) => String(s.season)).reverse(),
          logoUrl: row.logo,
        };
      });
  }

  async listTeams(competition: CompetitionRef, season: string): Promise<TeamRef[]> {
    const rows = await this.get<RugbyTeam>(`/teams?league=${competition.externalId}&season=${season.slice(0, 4)}`, 7 * DAY_MS);
    return rows.map((t) => ({
      externalId: String(t.id),
      name: t.name,
      country: t.country?.name,
      founded: t.founded,
      crestUrl: t.logo,
      venue: t.arena?.name ? { name: t.arena.name, city: t.arena.location, capacity: t.arena.capacity } : undefined,
    }));
  }

  async listEvents(competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]> {
    const rows = await this.get<RugbyGame>(`/games?league=${competition.externalId}&season=${season.slice(0, 4)}`, 15 * 60_000);
    return rows.map(mapGame).filter((e) => e.startsAt >= range.from && e.startsAt <= range.to);
  }

  async listHistory(competition: CompetitionRef, seasons: string[]): Promise<EventRef[]> {
    const out: EventRef[] = [];
    for (const season of seasons) {
      const rows = await this.get<RugbyGame>(`/games?league=${competition.externalId}&season=${season.slice(0, 4)}`, 30 * DAY_MS);
      for (const row of rows) if (mapStatus(row.status.short) === 'FINISHED') out.push(mapGame(row));
    }
    return out;
  }

  async getStandings(competition: CompetitionRef, season: string): Promise<StandingRow[]> {
    const rows = await this.get<{ position: number; team: { id: number }; games: { played: number; win: { total: number }; draw: { total: number }; lose: { total: number } }; points: { for: number; against: number }; form?: string }[]>(
      `/standings?league=${competition.externalId}&season=${season.slice(0, 4)}`,
      3_600_000,
    );
    const table = rows[0] ?? [];
    return table.map((row) => ({
      teamExternalId: String(row.team.id),
      position: row.position,
      played: row.games.played,
      won: row.games.win.total,
      drawn: row.games.draw.total,
      lost: row.games.lose.total,
      scoredFor: row.points.for,
      scoredAgainst: row.points.against,
      points: 0,
      form: row.form,
    }));
  }
}
