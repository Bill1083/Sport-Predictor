/**
 * cricketdata.org (the API formerly known as CricAPI): series, fixtures,
 * results and innings scores. The free key allows 100 hits a day, so the
 * adapter reads a series in one call and caches it for hours. Results carry
 * a text status ("X won by 5 wickets") which gives the winner; runs per side
 * come from the innings scores.
 */

import { env } from '@/lib/env';
import { providerJson } from '@/lib/providers/http';
import type { Capability, CompetitionRef, DateRange, EventRef, SportsDataProvider, TeamRef } from '@/lib/providers/provider';
import type { Outcome, SportKey } from '@/lib/sports/registry';
import type { EventStatus } from '@/lib/types';

const BASE = 'https://api.cricapi.com/v1';
const HOUR_MS = 3_600_000;

interface Series {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  odi?: number;
  t20?: number;
  test?: number;
  matches?: number;
}

interface Match {
  id: string;
  name: string;
  matchType?: string;
  status?: string;
  venue?: string;
  date?: string;
  dateTimeGMT?: string;
  teams?: string[];
  teamInfo?: { name: string; shortname?: string; img?: string }[];
  score?: { r?: number; w?: number; o?: number; inning?: string }[];
  series_id?: string;
  matchStarted?: boolean;
  matchEnded?: boolean;
}

interface Envelope<T> {
  status?: string;
  data?: T;
  info?: { hitsToday?: number; hitsLimit?: number };
}

export function teamRef(name: string, info?: { shortname?: string; img?: string }): TeamRef {
  return { externalId: name, name, shortName: info?.shortname, crestUrl: info?.img };
}

export function mapStatus(m: Match, now = new Date()): EventStatus {
  if (m.matchEnded) return 'FINISHED';
  if (m.matchStarted) return 'LIVE';
  if (m.status && /abandon|cancel|no result/i.test(m.status)) return 'CANCELLED';
  if (m.status && /postpone/i.test(m.status)) return 'POSTPONED';
  // A match well past its start that never reported starting was most likely called off.
  const start = m.dateTimeGMT ? new Date(`${m.dateTimeGMT}Z`) : null;
  return start && start.getTime() < now.getTime() - 2 * 86_400_000 ? 'CANCELLED' : 'SCHEDULED';
}

/** Runs per side from the innings list, matched to the team named in each inning label. */
function runsFor(m: Match, team: string): number | undefined {
  const innings = (m.score ?? []).filter((s) => s.inning && s.inning.toLowerCase().startsWith(team.toLowerCase()));
  if (innings.length === 0) return undefined;
  return innings.reduce((sum, s) => sum + (s.r ?? 0), 0);
}

export function mapMatch(m: Match, seriesId: string, season: string, now = new Date()): EventRef | null {
  const teams = m.teams ?? [];
  if (teams.length !== 2 || !m.dateTimeGMT) return null;
  const [homeName, awayName] = teams;
  const info = (name: string) => (m.teamInfo ?? []).find((t) => t.name === name);
  const status = mapStatus(m, now);
  let winner: Outcome | null | undefined;
  if (status === 'FINISHED' && m.status) {
    const s = m.status.toLowerCase();
    if (/drawn|tied|no result|abandon/.test(s)) winner = 'DRAW';
    else if (s.startsWith(homeName.toLowerCase())) winner = 'HOME';
    else if (s.startsWith(awayName.toLowerCase())) winner = 'AWAY';
    else {
      const short = (name: string) => info(name)?.shortname?.toLowerCase();
      if (short(homeName) && s.includes(`${short(homeName)} won`)) winner = 'HOME';
      else if (short(awayName) && s.includes(`${short(awayName)} won`)) winner = 'AWAY';
    }
  }
  const homeRuns = runsFor(m, homeName);
  const awayRuns = runsFor(m, awayName);
  const format = (m.matchType ?? '').toUpperCase() || undefined;
  return {
    externalId: m.id,
    competitionExternalId: seriesId,
    season,
    round: m.name?.replace(/^.*?,\s*/, '') || undefined,
    startsAt: new Date(`${m.dateTimeGMT}Z`),
    status,
    home: teamRef(homeName, info(homeName)),
    away: teamRef(awayName, info(awayName)),
    venue: m.venue ? { name: m.venue } : undefined,
    format,
    result:
      status === 'FINISHED' || status === 'LIVE'
        ? {
            ...(homeRuns !== undefined ? { homeScore: homeRuns } : {}),
            ...(awayRuns !== undefined ? { awayScore: awayRuns } : {}),
            ...(winner !== undefined ? { winner } : {}),
            extra: { status: m.status, innings: m.score ?? [] },
          }
        : undefined,
  };
}

export class CricketDataProvider implements SportsDataProvider {
  readonly key = 'cricketdata' as const;
  readonly label = 'cricketdata.org';
  readonly sports: SportKey[] = ['cricket'];
  readonly capabilities: Capability[] = ['competitions', 'teams', 'fixtures', 'results', 'history'];

  configured(): boolean {
    return Boolean(env.cricketDataKey);
  }

  private async get<T>(path: string, params: Record<string, string>, ttlMs: number): Promise<T | undefined> {
    const query = new URLSearchParams({ apikey: env.cricketDataKey ?? '', ...params }).toString();
    const data = await providerJson<Envelope<T>>(this.key, `${BASE}/${path}?${query}`, { ttlMs, timeoutMs: 20_000 });
    if (data.status && data.status !== 'success') throw new Error(`cricketdata: ${data.status}`);
    return data.data;
  }

  /** Series that are current or upcoming: two pages of the catalogue, filtered by date. */
  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    if (sport !== 'cricket') return [];
    const now = Date.now();
    const out: CompetitionRef[] = [];
    for (const offset of [0, 25]) {
      const series = (await this.get<Series[]>('series', { offset: String(offset) }, 12 * HOUR_MS)) ?? [];
      for (const s of series) {
        const end = s.endDate ? Date.parse(s.endDate) : NaN;
        if (Number.isFinite(end) && end < now - 30 * 86_400_000) continue;
        const start = s.startDate ? new Date(s.startDate) : null;
        const formats = [s.test ? 'Test' : null, s.odi ? 'ODI' : null, s.t20 ? 'T20' : null].filter(Boolean).join('/');
        out.push({
          externalId: s.id,
          name: s.name,
          shortName: formats || undefined,
          type: /cup|trophy|league|ipl|hundred|blast|bbl|psl|cpl/i.test(s.name) ? 'LEAGUE' : 'INTERNATIONAL',
          currentSeason: start ? String(start.getUTCFullYear()) : undefined,
          tier: /world cup|ashes|ipl|hundred/i.test(s.name) ? 1 : 2,
        });
      }
      if (series.length < 25) break;
    }
    return out;
  }

  private async matches(seriesId: string, ttlMs: number): Promise<Match[]> {
    const info = await this.get<{ info?: Series; matchList?: Match[] }>('series_info', { id: seriesId }, ttlMs);
    return info?.matchList ?? [];
  }

  async listTeams(competition: CompetitionRef): Promise<TeamRef[]> {
    const matches = await this.matches(competition.externalId, 12 * HOUR_MS);
    const seen = new Map<string, TeamRef>();
    for (const m of matches) for (const name of m.teams ?? []) if (!seen.has(name)) seen.set(name, teamRef(name, (m.teamInfo ?? []).find((t) => t.name === name)));
    return Array.from(seen.values());
  }

  async listEvents(competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]> {
    const matches = await this.matches(competition.externalId, 3 * HOUR_MS);
    return matches
      .map((m) => mapMatch(m, competition.externalId, season || competition.currentSeason || ''))
      .filter((e): e is EventRef => e !== null && e.startsAt >= range.from && e.startsAt <= range.to);
  }

  async listHistory(competition: CompetitionRef, seasons: string[]): Promise<EventRef[]> {
    const matches = await this.matches(competition.externalId, 24 * HOUR_MS);
    return matches.map((m) => mapMatch(m, competition.externalId, seasons[0] ?? competition.currentSeason ?? '')).filter((e): e is EventRef => e !== null && e.status === 'FINISHED');
  }
}
