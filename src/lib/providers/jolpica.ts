/**
 * Jolpica-F1: the community successor to the Ergast API. Schedule, drivers,
 * qualifying (grid) and race results for every season since 1950, free and
 * keyless. One race is one multi-entrant event whose entrants are drivers.
 */

import { providerJson } from '@/lib/providers/http';
import type { Capability, CompetitionRef, DateRange, EventRef, SportsDataProvider, TeamRef } from '@/lib/providers/provider';
import type { SportKey } from '@/lib/sports/registry';

const BASE = 'https://api.jolpi.ca/ergast/f1';
const DAY_MS = 86_400_000;

interface Driver {
  driverId: string;
  code?: string;
  givenName: string;
  familyName: string;
  nationality?: string;
  permanentNumber?: string;
}

interface Constructor {
  constructorId: string;
  name: string;
}

interface Race {
  season: string;
  round: string;
  raceName: string;
  Circuit: { circuitId: string; circuitName: string; Location?: { lat?: string; long?: string; locality?: string; country?: string } };
  date: string;
  time?: string;
  Results?: { position: string; positionText: string; points: string; grid: string; status: string; Driver: Driver; Constructor: Constructor }[];
  QualifyingResults?: { position: string; Driver: Driver; Constructor: Constructor }[];
}

interface MRData {
  MRData: { total?: string; limit?: string; offset?: string; RaceTable?: { Races?: Race[] }; DriverTable?: { Drivers?: Driver[] } };
}

/** Jolpica serves at most 100 rows per page. */
const PAGE = 100;

export function driverRef(d: Driver, constructor?: Constructor): TeamRef {
  return {
    externalId: d.driverId,
    name: `${d.givenName} ${d.familyName}`,
    shortName: d.familyName,
    code: d.code,
    country: constructor?.name ?? d.nationality,
    kind: 'DRIVER',
  };
}

export function raceStart(race: Race): Date {
  return new Date(`${race.date}T${race.time ?? '14:00:00Z'}`);
}

/** A race with whatever is known: results (finished), qualifying (grid) or just the entry list. */
export function mapRace(race: Race, drivers: Driver[], now = new Date()): EventRef {
  const startsAt = raceStart(race);
  const finished = (race.Results?.length ?? 0) > 0;
  const status = finished ? 'FINISHED' : startsAt.getTime() < now.getTime() - 3 * 3_600_000 ? 'SCHEDULED' : startsAt.getTime() <= now.getTime() ? 'LIVE' : 'SCHEDULED';
  let entrants: EventRef['entrants'];
  if (finished) {
    entrants = (race.Results ?? []).map((r) => ({
      team: driverRef(r.Driver, r.Constructor),
      gridPosition: Number(r.grid) > 0 ? Number(r.grid) : undefined,
      finishPosition: Number(r.position),
      score: Number(r.points),
      statusNote: r.status,
    }));
  } else if ((race.QualifyingResults?.length ?? 0) > 0) {
    entrants = (race.QualifyingResults ?? []).map((q) => ({ team: driverRef(q.Driver, q.Constructor), gridPosition: Number(q.position) }));
  } else {
    entrants = drivers.map((d) => ({ team: driverRef(d) }));
  }
  const winner = entrants.find((e) => e.finishPosition === 1);
  const loc = race.Circuit.Location;
  return {
    externalId: `${race.season}-${race.round}`,
    competitionExternalId: 'f1',
    season: race.season,
    round: `Round ${race.round}: ${race.raceName}`,
    startsAt,
    status,
    home: { externalId: 'f1-field', name: 'Field' },
    away: { externalId: 'f1-field', name: 'Field' },
    venue: { name: race.Circuit.circuitName, city: loc?.locality, country: loc?.country, lat: loc?.lat ? Number(loc.lat) : undefined, lon: loc?.long ? Number(loc.long) : undefined },
    entrants,
    result: winner ? { winner: null, extra: { winnerName: winner.team.name } } : undefined,
  };
}

export class JolpicaProvider implements SportsDataProvider {
  readonly key = 'jolpica' as const;
  readonly label = 'Jolpica F1';
  readonly sports: SportKey[] = ['f1'];
  readonly capabilities: Capability[] = ['competitions', 'teams', 'fixtures', 'results', 'history'];

  configured(): boolean {
    return true;
  }

  /** Every page of a race-table endpoint, merged so a race split across pages keeps all its rows. */
  private async races(path: string, ttlMs: number): Promise<Race[]> {
    const byRound = new Map<string, Race>();
    for (let offset = 0; offset < 5_000; offset += PAGE) {
      const data = await providerJson<MRData>(this.key, `${BASE}${path}?limit=${PAGE}&offset=${offset}`, { ttlMs, timeoutMs: 20_000 });
      for (const race of data.MRData?.RaceTable?.Races ?? []) {
        const existing = byRound.get(race.round);
        if (!existing) byRound.set(race.round, { ...race });
        else {
          if (race.Results) existing.Results = [...(existing.Results ?? []), ...race.Results];
          if (race.QualifyingResults) existing.QualifyingResults = [...(existing.QualifyingResults ?? []), ...race.QualifyingResults];
        }
      }
      const total = Number(data.MRData?.total ?? 0);
      if (!Number.isFinite(total) || offset + PAGE >= total) break;
    }
    return Array.from(byRound.values());
  }

  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    if (sport !== 'f1') return [];
    const year = new Date().getUTCFullYear();
    return [
      {
        externalId: 'f1',
        name: 'Formula 1 World Championship',
        shortName: 'F1',
        country: 'World',
        type: 'CHAMPIONSHIP',
        currentSeason: String(year),
        seasons: Array.from({ length: 8 }, (_, i) => String(year - i)),
        tier: 1,
      },
    ];
  }

  async listTeams(_competition: CompetitionRef, season: string): Promise<TeamRef[]> {
    const data = await providerJson<MRData>(this.key, `${BASE}/${season.slice(0, 4)}/drivers.json?limit=100`, { ttlMs: 7 * DAY_MS });
    return (data.MRData?.DriverTable?.Drivers ?? []).map((d) => driverRef(d));
  }

  /** The season's schedule with results and grids merged in. */
  private async season(year: string, ttlMs: number): Promise<EventRef[]> {
    const [schedule, results, qualifying, driverData] = await Promise.all([
      this.races(`/${year}.json`, ttlMs),
      this.races(`/${year}/results.json`, ttlMs),
      this.races(`/${year}/qualifying.json`, ttlMs),
      providerJson<MRData>(this.key, `${BASE}/${year}/drivers.json?limit=100`, { ttlMs: Math.max(ttlMs, DAY_MS) }),
    ]);
    const byRound = new Map<string, Race>();
    for (const race of schedule) byRound.set(race.round, { ...race });
    for (const race of results) {
      const entry = byRound.get(race.round);
      if (entry) entry.Results = race.Results;
    }
    for (const race of qualifying) {
      const entry = byRound.get(race.round);
      if (entry) entry.QualifyingResults = race.QualifyingResults;
    }
    // The entry list for races still to come: whoever started the latest race, since the
    // season's driver list also carries substitutes and reserves who have long gone home.
    const latest = results.filter((r) => (r.Results?.length ?? 0) > 0).sort((a, b) => Number(b.round) - Number(a.round))[0];
    const drivers = latest ? (latest.Results ?? []).map((r) => r.Driver) : (driverData.MRData?.DriverTable?.Drivers ?? []);
    return Array.from(byRound.values()).map((race) => mapRace(race, drivers));
  }

  async listEvents(_competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]> {
    const events = await this.season(season.slice(0, 4), 30 * 60_000);
    return events.filter((e) => e.startsAt >= range.from && e.startsAt <= range.to);
  }

  async listHistory(_competition: CompetitionRef, seasons: string[]): Promise<EventRef[]> {
    const out: EventRef[] = [];
    for (const season of seasons) {
      const events = await this.season(season.slice(0, 4), 60 * DAY_MS);
      for (const e of events) if (e.status === 'FINISHED') out.push(e);
    }
    return out;
  }
}
