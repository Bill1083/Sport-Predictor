/**
 * football-data.org v4. Free tier: twelve competitions, fixtures, results
 * (delayed), standings and head-to-head; ten requests a minute. Lineups and
 * statistics need a paid plan, so this adapter does not claim them.
 */

import { env } from '@/lib/env';
import { providerJson } from '@/lib/providers/http';
import type { Capability, CompetitionRef, DateRange, EventRef, SportsDataProvider, StandingRow, TeamRef } from '@/lib/providers/provider';
import type { SportKey } from '@/lib/sports/registry';
import type { EventStatus } from '@/lib/types';

const BASE = 'https://api.football-data.org/v4';
const DAY_MS = 86_400_000;

interface FdCompetition {
  id: number;
  name: string;
  code: string;
  type: string;
  emblem?: string;
  area?: { name?: string; code?: string };
  currentSeason?: { startDate?: string; endDate?: string; currentMatchday?: number };
}

interface FdTeam {
  id: number;
  name: string;
  shortName?: string;
  tla?: string;
  crest?: string;
  venue?: string;
  founded?: number;
  address?: string;
}

interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday?: number;
  stage?: string;
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score?: { winner?: string | null; fullTime?: { home: number | null; away: number | null } };
  referees?: { name?: string }[];
  competition?: { code?: string; id?: number };
  season?: { startDate?: string };
}

export function mapStatus(status: string): EventStatus {
  switch (status) {
    case 'FINISHED':
    case 'AWARDED':
      return 'FINISHED';
    case 'IN_PLAY':
    case 'PAUSED':
      return 'LIVE';
    case 'POSTPONED':
    case 'SUSPENDED':
      return 'POSTPONED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'SCHEDULED';
  }
}

function team(t: FdTeam): TeamRef {
  return { externalId: String(t.id), name: t.name, shortName: t.shortName, code: t.tla, crestUrl: t.crest, founded: t.founded, venue: t.venue ? { name: t.venue } : undefined };
}

export function mapMatch(m: FdMatch, competitionExternalId: string, season: string): EventRef {
  const status = mapStatus(m.status);
  const ft = m.score?.fullTime;
  const hasScore = typeof ft?.home === 'number' && typeof ft?.away === 'number';
  return {
    externalId: String(m.id),
    competitionExternalId,
    season,
    round: m.matchday ? `Matchday ${m.matchday}` : undefined,
    stage: m.stage,
    startsAt: new Date(m.utcDate),
    status,
    home: team(m.homeTeam),
    away: team(m.awayTeam),
    referee: m.referees?.[0]?.name,
    result:
      status !== 'SCHEDULED' && hasScore
        ? {
            homeScore: ft!.home as number,
            awayScore: ft!.away as number,
            winner: status === 'FINISHED' ? (m.score?.winner === 'HOME_TEAM' ? 'HOME' : m.score?.winner === 'AWAY_TEAM' ? 'AWAY' : 'DRAW') : undefined,
          }
        : undefined,
  };
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

export class FootballDataProvider implements SportsDataProvider {
  readonly key = 'football-data' as const;
  readonly label = 'football-data.org';
  readonly sports: SportKey[] = ['football'];
  readonly capabilities: Capability[] = ['competitions', 'teams', 'fixtures', 'results', 'standings', 'history'];

  configured(): boolean {
    return Boolean(env.footballDataApiKey);
  }

  private headers(): Record<string, string> {
    return { 'X-Auth-Token': env.footballDataApiKey ?? '' };
  }

  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    if (sport !== 'football') return [];
    const data = await providerJson<{ competitions?: FdCompetition[] }>(this.key, `${BASE}/competitions`, { headers: this.headers(), ttlMs: 24 * 3_600_000 });
    return (data.competitions ?? []).map((c) => ({
      externalId: c.code || String(c.id),
      name: c.name,
      country: c.area?.name,
      type: c.type === 'CUP' ? 'CUP' : 'LEAGUE',
      currentSeason: c.currentSeason?.startDate ? c.currentSeason.startDate.slice(0, 4) : undefined,
      logoUrl: c.emblem,
    }));
  }

  async listTeams(competition: CompetitionRef, season: string): Promise<TeamRef[]> {
    const year = season.slice(0, 4);
    const data = await providerJson<{ teams?: FdTeam[] }>(this.key, `${BASE}/competitions/${competition.externalId}/teams?season=${year}`, { headers: this.headers(), ttlMs: 7 * DAY_MS, emptyStatuses: [403, 404] });
    return (data.teams ?? []).map(team);
  }

  async listEvents(competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]> {
    const year = season.slice(0, 4);
    // The API caps a window at 10 days unless the season is given; with season it returns the lot.
    const url = `${BASE}/competitions/${competition.externalId}/matches?season=${year}&dateFrom=${fmt(range.from)}&dateTo=${fmt(range.to)}`;
    const data = await providerJson<{ matches?: FdMatch[] }>(this.key, url, { headers: this.headers(), ttlMs: 15 * 60_000, emptyStatuses: [403, 404] });
    return (data.matches ?? []).map((m) => mapMatch(m, competition.externalId, year));
  }

  async listHistory(competition: CompetitionRef, seasons: string[]): Promise<EventRef[]> {
    const out: EventRef[] = [];
    for (const season of seasons) {
      const year = season.slice(0, 4);
      const data = await providerJson<{ matches?: FdMatch[] }>(this.key, `${BASE}/competitions/${competition.externalId}/matches?season=${year}`, { headers: this.headers(), ttlMs: 30 * DAY_MS, emptyStatuses: [403, 404] });
      for (const m of data.matches ?? []) if (m.status === 'FINISHED') out.push(mapMatch(m, competition.externalId, year));
    }
    return out;
  }

  async getStandings(competition: CompetitionRef, season: string): Promise<StandingRow[]> {
    const year = season.slice(0, 4);
    const data = await providerJson<{ standings?: { type: string; table: { position: number; team: FdTeam; playedGames: number; won: number; draw: number; lost: number; goalsFor: number; goalsAgainst: number; points: number; form?: string }[] }[] }>(
      this.key,
      `${BASE}/competitions/${competition.externalId}/standings?season=${year}`,
      { headers: this.headers(), ttlMs: 3_600_000, emptyStatuses: [403, 404] },
    );
    const total = (data.standings ?? []).find((s) => s.type === 'TOTAL');
    return (total?.table ?? []).map((row) => ({
      teamExternalId: String(row.team.id),
      position: row.position,
      played: row.playedGames,
      won: row.won,
      drawn: row.draw,
      lost: row.lost,
      scoredFor: row.goalsFor,
      scoredAgainst: row.goalsAgainst,
      points: row.points,
      form: row.form?.replace(/,/g, ''),
    }));
  }
}
