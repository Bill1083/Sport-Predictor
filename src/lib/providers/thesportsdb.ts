/**
 * TheSportsDB v1 with the public key. Best for crests, stadiums and player
 * photos; also a serviceable fixtures and results feed for many leagues
 * across sports. Around 30 requests a minute on the free key.
 */

import { env } from '@/lib/env';
import { providerJson } from '@/lib/providers/http';
import type { Capability, CompetitionRef, DateRange, EventRef, SportsDataProvider, StandingRow, TeamRef } from '@/lib/providers/provider';
import type { SportKey } from '@/lib/sports/registry';
import { curatedFor, currentStartYear } from '@/lib/sports/competitions';
import type { EventStatus } from '@/lib/types';

const DAY_MS = 86_400_000;

const SPORT_NAMES: Partial<Record<SportKey, string>> = {
  football: 'Soccer',
  rugby_union: 'Rugby',
  rugby_league: 'Rugby',
  cricket: 'Cricket',
  tennis: 'Tennis',
  f1: 'Motorsport',
  basketball: 'Basketball',
  american_football: 'American Football',
  ice_hockey: 'Ice Hockey',
  baseball: 'Baseball',
};

interface TsdbLeague {
  idLeague: string;
  strLeague: string;
  strSport?: string;
  strCountry?: string;
  strCurrentSeason?: string;
  strBadge?: string;
  strLogo?: string;
}

interface TsdbTeam {
  idTeam: string;
  strTeam: string;
  strTeamShort?: string | null;
  strBadge?: string | null;
  strTeamBadge?: string | null;
  strStadium?: string | null;
  strLocation?: string | null;
  strStadiumLocation?: string | null;
  intStadiumCapacity?: string | null;
  intFormedYear?: string | null;
  strCountry?: string | null;
}

interface TsdbEvent {
  idEvent: string;
  strEvent?: string;
  dateEvent?: string | null;
  strTime?: string | null;
  strTimestamp?: string | null;
  intRound?: string | null;
  idHomeTeam?: string | null;
  idAwayTeam?: string | null;
  strHomeTeam?: string | null;
  strAwayTeam?: string | null;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  strStatus?: string | null;
  strVenue?: string | null;
  strSeason?: string | null;
}

export function mapStatus(status: string | null | undefined, startsAt: Date, now = new Date()): EventStatus {
  const s = (status ?? '').toLowerCase();
  if (s === 'match finished' || s === 'ft' || s === 'finished' || s === 'aet' || s === 'pen') return 'FINISHED';
  if (s === 'postponed') return 'POSTPONED';
  if (s === 'cancelled' || s === 'canceled') return 'CANCELLED';
  if (s.includes('half') || s === 'live' || s === 'in play' || /^\d+'?$/.test(s)) return 'LIVE';
  if (s === 'not started' || s === 'ns' || s === '') return startsAt.getTime() < now.getTime() - 3 * 3_600_000 && s === '' ? 'SCHEDULED' : 'SCHEDULED';
  return 'SCHEDULED';
}

export function eventStart(e: TsdbEvent): Date | null {
  if (e.strTimestamp) {
    const d = new Date(e.strTimestamp.includes('T') ? `${e.strTimestamp}${/Z|[+-]\d\d:\d\d$/.test(e.strTimestamp) ? '' : 'Z'}` : e.strTimestamp);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (e.dateEvent) {
    const d = new Date(`${e.dateEvent}T${e.strTime && /^\d\d:\d\d/.test(e.strTime) ? e.strTime.slice(0, 8) : '15:00:00'}Z`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function mapEvent(e: TsdbEvent, competitionExternalId: string, season: string): EventRef | null {
  const startsAt = eventStart(e);
  if (!startsAt || !e.idHomeTeam || !e.idAwayTeam || !e.strHomeTeam || !e.strAwayTeam) return null;
  const status = mapStatus(e.strStatus, startsAt);
  const hs = e.intHomeScore !== null && e.intHomeScore !== undefined && e.intHomeScore !== '' ? Number(e.intHomeScore) : null;
  const as = e.intAwayScore !== null && e.intAwayScore !== undefined && e.intAwayScore !== '' ? Number(e.intAwayScore) : null;
  const finished = status === 'FINISHED' || (status === 'SCHEDULED' && hs !== null && as !== null && startsAt.getTime() < Date.now() - 3 * 3_600_000);
  return {
    externalId: e.idEvent,
    competitionExternalId,
    season,
    round: e.intRound ? `Round ${e.intRound}` : undefined,
    startsAt,
    status: finished ? 'FINISHED' : status,
    home: { externalId: e.idHomeTeam, name: e.strHomeTeam },
    away: { externalId: e.idAwayTeam, name: e.strAwayTeam },
    venue: e.strVenue ? { name: e.strVenue } : undefined,
    result: hs !== null && as !== null ? { homeScore: hs, awayScore: as, winner: finished ? (hs > as ? 'HOME' : hs < as ? 'AWAY' : 'DRAW') : undefined } : undefined,
  };
}

/** "2026-2027" for cross-year leagues, "2026" otherwise; TheSportsDB uses both. */
export function tsdbSeason(startYear: string, crossYear: boolean): string {
  const y = Number(startYear.slice(0, 4));
  return crossYear ? `${y}-${y + 1}` : String(y);
}

export class TheSportsDbProvider implements SportsDataProvider {
  readonly key = 'thesportsdb' as const;
  readonly label = 'TheSportsDB';
  readonly sports: SportKey[] = ['football', 'rugby_union', 'rugby_league', 'cricket', 'tennis', 'f1', 'basketball', 'american_football', 'ice_hockey', 'baseball'];
  readonly capabilities: Capability[] = ['competitions', 'teams', 'fixtures', 'results', 'history', 'crests'];

  configured(): boolean {
    return true;
  }

  private base(): string {
    return `https://www.thesportsdb.com/api/v1/json/${env.theSportsDbKey}`;
  }

  private crossYear(competition: CompetitionRef): boolean {
    const curated = curatedFor('football').find((c) => c.ids.thesportsdb === competition.externalId);
    return curated ? curated.crossYear : true;
  }

  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    const name = SPORT_NAMES[sport];
    if (!name) return [];
    const data = await providerJson<{ countries?: TsdbLeague[] | null; leagues?: TsdbLeague[] | null }>(this.key, `${this.base()}/search_all_leagues.php?s=${encodeURIComponent(name)}`, { ttlMs: 7 * DAY_MS });
    const list = data.countries ?? data.leagues ?? [];
    const year = currentStartYear(new Date(), true);
    return list.map((l) => ({
      externalId: l.idLeague,
      name: l.strLeague,
      country: l.strCountry,
      type: /cup|trophy|shield/i.test(l.strLeague) ? 'CUP' : 'LEAGUE',
      currentSeason: l.strCurrentSeason ? l.strCurrentSeason.slice(0, 4) : String(year),
      logoUrl: l.strBadge ?? l.strLogo,
    }));
  }

  async listTeams(competition: CompetitionRef): Promise<TeamRef[]> {
    const data = await providerJson<{ teams?: TsdbTeam[] | null }>(this.key, `${this.base()}/lookup_all_teams.php?id=${competition.externalId}`, { ttlMs: 7 * DAY_MS });
    return (data.teams ?? []).map((t) => ({
      externalId: t.idTeam,
      name: t.strTeam,
      shortName: t.strTeamShort ?? undefined,
      crestUrl: t.strBadge ?? t.strTeamBadge ?? undefined,
      founded: t.intFormedYear ? Number(t.intFormedYear) : undefined,
      country: t.strCountry ?? undefined,
      venue: t.strStadium ? { name: t.strStadium, city: t.strStadiumLocation ?? t.strLocation ?? undefined, capacity: t.intStadiumCapacity ? Number(t.intStadiumCapacity) : undefined } : undefined,
    }));
  }

  async listEvents(competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]> {
    const label = tsdbSeason(season, this.crossYear(competition));
    const data = await providerJson<{ events?: TsdbEvent[] | null }>(this.key, `${this.base()}/eventsseason.php?id=${competition.externalId}&s=${encodeURIComponent(label)}`, { ttlMs: 30 * 60_000 });
    return (data.events ?? [])
      .map((e) => mapEvent(e, competition.externalId, season.slice(0, 4)))
      .filter((e): e is EventRef => e !== null && e.startsAt >= range.from && e.startsAt <= range.to);
  }

  async listHistory(competition: CompetitionRef, seasons: string[]): Promise<EventRef[]> {
    const out: EventRef[] = [];
    for (const season of seasons) {
      const label = tsdbSeason(season, this.crossYear(competition));
      const data = await providerJson<{ events?: TsdbEvent[] | null }>(this.key, `${this.base()}/eventsseason.php?id=${competition.externalId}&s=${encodeURIComponent(label)}`, { ttlMs: 30 * DAY_MS });
      for (const e of data.events ?? []) {
        const ref = mapEvent(e, competition.externalId, season.slice(0, 4));
        if (ref?.status === 'FINISHED') out.push(ref);
      }
    }
    return out;
  }

  async getStandings(competition: CompetitionRef, season: string): Promise<StandingRow[]> {
    const label = tsdbSeason(season, this.crossYear(competition));
    const data = await providerJson<{ table?: { idTeam: string; intRank: string; intPlayed: string; intWin: string; intDraw: string; intLoss: string; intGoalsFor: string; intGoalsAgainst: string; intPoints: string; strForm?: string }[] | null }>(
      this.key,
      `${this.base()}/lookuptable.php?l=${competition.externalId}&s=${encodeURIComponent(label)}`,
      { ttlMs: 3_600_000 },
    );
    return (data.table ?? []).map((row) => ({
      teamExternalId: row.idTeam,
      position: Number(row.intRank),
      played: Number(row.intPlayed),
      won: Number(row.intWin),
      drawn: Number(row.intDraw),
      lost: Number(row.intLoss),
      scoredFor: Number(row.intGoalsFor),
      scoredAgainst: Number(row.intGoalsAgainst),
      points: Number(row.intPoints),
      form: row.strForm ?? undefined,
    }));
  }

  /** Crest lookup by name, for teams another provider created without one. */
  async findTeamByName(name: string): Promise<TeamRef | null> {
    const data = await providerJson<{ teams?: TsdbTeam[] | null }>(this.key, `${this.base()}/searchteams.php?t=${encodeURIComponent(name)}`, { ttlMs: 30 * DAY_MS });
    const t = data.teams?.[0];
    if (!t) return null;
    return { externalId: t.idTeam, name: t.strTeam, shortName: t.strTeamShort ?? undefined, crestUrl: t.strBadge ?? t.strTeamBadge ?? undefined, venue: t.strStadium ? { name: t.strStadium, city: t.strStadiumLocation ?? undefined } : undefined };
  }
}
