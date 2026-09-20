/**
 * ESPN's public (undocumented) tennis scoreboard. One call per day per tour
 * returns every tournament in play that day with all of its matches, past
 * and scheduled, so a short run of days covers the coming week. Unofficial:
 * treated as best effort and never counted on for history.
 */

import { providerJson } from '@/lib/providers/http';
import type { Capability, CompetitionRef, DateRange, EventRef, SportsDataProvider, TeamRef } from '@/lib/providers/provider';
import { sidesFor, TOURS } from '@/lib/providers/tennis-archive';
import type { SportKey } from '@/lib/sports/registry';
import type { EventStatus } from '@/lib/types';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis';
const DAY_MS = 86_400_000;
/** Days scanned around today whatever range the job asks for: each is one request per tour. */
const LOOKBACK_DAYS = 2;
const LOOKAHEAD_DAYS = 7;

interface Competitor {
  id: string;
  homeAway?: string;
  winner?: boolean;
  linescores?: { value: number; tiebreak?: number; winner?: boolean }[];
  athlete?: { displayName?: string; fullName?: string; shortName?: string; flag?: { alt?: string } };
}

interface Competition {
  id: string;
  date: string;
  status?: { type?: { state?: string; completed?: boolean; name?: string } };
  venue?: { fullName?: string; court?: string };
  format?: { regulation?: { periods?: number } };
  competitors?: Competitor[];
}

interface Tournament {
  id: string;
  name: string;
  date: string;
  season?: { year?: number };
  venue?: { fullName?: string };
  groupings?: { grouping?: { slug?: string; displayName?: string }; competitions?: Competition[] }[];
}

interface Scoreboard {
  events?: Tournament[];
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

export function mapStatus(state: string | undefined, completed: boolean | undefined, name: string | undefined): EventStatus {
  if (completed || state === 'post') return 'FINISHED';
  if (state === 'in') return 'LIVE';
  if (name && /postpone/i.test(name)) return 'POSTPONED';
  if (name && /cancel/i.test(name)) return 'CANCELLED';
  return 'SCHEDULED';
}

function playerRef(c: Competitor): TeamRef | null {
  const name = c.athlete?.displayName ?? c.athlete?.fullName;
  if (!name) return null;
  return { externalId: c.id, name, shortName: c.athlete?.shortName ?? name.split(' ').slice(-1)[0], country: c.athlete?.flag?.alt, kind: 'PLAYER' };
}

/** Singles only; doubles pairs are skipped. */
export function mapMatch(tour: string, tournament: Tournament, roundLabel: string, match: Competition): EventRef | null {
  const competitors = match.competitors ?? [];
  if (competitors.length !== 2 || competitors.some((c) => c.athlete === undefined)) return null;
  const a = playerRef(competitors[0]);
  const b = playerRef(competitors[1]);
  if (!a || !b) return null;
  const aHome = sidesFor(a.name, b.name);
  const home = aHome ? competitors[0] : competitors[1];
  const away = aHome ? competitors[1] : competitors[0];
  const status = mapStatus(match.status?.type?.state, match.status?.type?.completed, match.status?.type?.name);
  const setsWon = (c: Competitor) => (c.linescores ?? []).filter((l) => l.winner === true).length;
  const games = (c: Competitor) => (c.linescores ?? []).reduce((s, l) => s + (l.value ?? 0), 0);
  const bestOf = match.format?.regulation?.periods ?? 3;
  const finished = status === 'FINISHED';
  const winner = finished ? (home.winner ? 'HOME' : away.winner ? 'AWAY' : setsWon(home) > setsWon(away) ? 'HOME' : setsWon(away) > setsWon(home) ? 'AWAY' : null) : null;
  return {
    externalId: match.id,
    competitionExternalId: tour,
    season: String(tournament.season?.year ?? new Date(match.date).getUTCFullYear()),
    round: `${tournament.name} ${roundLabel}`.trim(),
    startsAt: new Date(match.date),
    status,
    home: aHome ? a : b,
    away: aHome ? b : a,
    venue: tournament.venue?.fullName ? { name: tournament.venue.fullName } : undefined,
    format: `BO${bestOf}`,
    result:
      finished && winner
        ? { homeScore: setsWon(home), awayScore: setsWon(away), winner, extra: { games: [games(home), games(away)] } }
        : status === 'LIVE'
          ? { homeScore: setsWon(home), awayScore: setsWon(away), extra: { games: [games(home), games(away)] } }
          : undefined,
  };
}

export class EspnTennisProvider implements SportsDataProvider {
  readonly key = 'espn' as const;
  readonly label = 'ESPN scoreboard (unofficial)';
  readonly sports: SportKey[] = ['tennis'];
  readonly capabilities: Capability[] = ['competitions', 'fixtures', 'results'];

  configured(): boolean {
    return true;
  }

  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    if (sport !== 'tennis') return [];
    const year = new Date().getUTCFullYear();
    return TOURS.map((t) => ({ ...t, currentSeason: String(year) }));
  }

  async listTeams(): Promise<TeamRef[]> {
    return [];
  }

  async listEvents(competition: CompetitionRef, _season: string, range: DateRange, now = new Date()): Promise<EventRef[]> {
    const tour = competition.externalId;
    const from = new Date(Math.max(range.from.getTime(), now.getTime() - LOOKBACK_DAYS * DAY_MS));
    const to = new Date(Math.min(range.to.getTime(), now.getTime() + LOOKAHEAD_DAYS * DAY_MS));
    const seen = new Map<string, EventRef>();
    for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
      const day = dayKey(new Date(t));
      const board = await providerJson<Scoreboard>(this.key, `${BASE}/${tour}/scoreboard?dates=${day}`, { ttlMs: 20 * 60_000, timeoutMs: 20_000 });
      for (const tournament of board.events ?? []) {
        for (const grouping of tournament.groupings ?? []) {
          const slug = grouping.grouping?.slug ?? '';
          if (!/singles/.test(slug)) continue;
          for (const match of grouping.competitions ?? []) {
            const ref = mapMatch(tour, tournament, grouping.grouping?.displayName ?? '', match);
            if (ref && !seen.has(ref.externalId)) seen.set(ref.externalId, ref);
          }
        }
      }
    }
    return Array.from(seen.values()).filter((e) => e.startsAt >= range.from && e.startsAt <= range.to);
  }
}
