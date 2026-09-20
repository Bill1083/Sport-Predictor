/**
 * The data-provider abstraction every sync job talks to.
 *
 * A provider turns one upstream source (football-data.org, API-Sports,
 * TheSportsDB, a CSV archive, the built-in mock) into the same normalised
 * shapes. Providers know nothing about the database: the sync jobs resolve
 * the returned references into rows through lib/entities/linking.ts, and
 * every reference carries the provider's own id so the mapping is remembered.
 */

import type { SportKey } from '@/lib/sports/registry';
import type { EventResult, EventStatus } from '@/lib/types';

export type ProviderKey =
  | 'mock'
  | 'football-data'
  | 'api-sports'
  | 'api-sports-rugby'
  | 'tennis-archive'
  | 'thesportsdb'
  | 'football-data-co-uk'
  | 'clubelo'
  | 'open-meteo'
  | 'news-rss'
  | 'odds-api'
  | 'espn'
  | 'cricketdata'
  | 'cricsheet'
  | 'jolpica'
  | 'openf1';

export type Capability =
  | 'competitions'
  | 'teams'
  | 'fixtures'
  | 'results'
  | 'standings'
  | 'lineups'
  | 'injuries'
  | 'eventStats'
  | 'playerStats'
  | 'history'
  | 'crests'
  | 'odds';

export interface CompetitionRef {
  externalId: string;
  name: string;
  shortName?: string;
  country?: string;
  type?: 'LEAGUE' | 'CUP' | 'INTERNATIONAL' | 'TOUR' | 'CHAMPIONSHIP';
  currentSeason?: string;
  /** Seasons the provider can serve, newest first. */
  seasons?: string[];
  logoUrl?: string;
  tier?: number;
}

export interface VenueRef {
  name: string;
  city?: string;
  country?: string;
  lat?: number;
  lon?: number;
  capacity?: number;
}

export interface TeamRef {
  externalId: string;
  name: string;
  shortName?: string;
  code?: string;
  country?: string;
  crestUrl?: string;
  venue?: VenueRef;
  founded?: number;
  /** TEAM | PLAYER | DRIVER | CONSTRUCTOR; defaults to TEAM. */
  kind?: string;
}

export interface EventRef {
  externalId: string;
  competitionExternalId: string;
  season: string;
  round?: string;
  stage?: string;
  startsAt: Date;
  status: EventStatus;
  minute?: number;
  home: TeamRef;
  away: TeamRef;
  result?: EventResult;
  venue?: VenueRef;
  referee?: string;
  format?: string;
  /** Multi-entrant events (F1) list everyone here instead of home/away. */
  entrants?: { team: TeamRef; gridPosition?: number; finishPosition?: number; score?: number; statusNote?: string }[];
}

export interface EventStatsRef {
  eventExternalId: string;
  teamExternalId: string;
  stats: Record<string, number>;
}

export interface LineupPlayer {
  name: string;
  position?: string;
  number?: number;
  externalId?: string;
}

export interface LineupRef {
  eventExternalId: string;
  teamExternalId: string;
  formation?: string;
  coach?: string;
  starters: LineupPlayer[];
  bench: LineupPlayer[];
  confirmed: boolean;
}

export interface InjuryRef {
  teamExternalId: string;
  playerName: string;
  playerExternalId?: string;
  type: string;
  /** OUT | DOUBTFUL | QUESTIONABLE | SUSPENDED */
  status: string;
  reason?: string;
  reportedAt?: Date;
  expectedReturn?: Date;
}

export interface StandingRow {
  teamExternalId: string;
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  scoredFor: number;
  scoredAgainst: number;
  points: number;
  form?: string;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface SportsDataProvider {
  readonly key: ProviderKey;
  readonly label: string;
  readonly sports: SportKey[];
  readonly capabilities: Capability[];
  /** False when the key it needs is missing; the registry then skips it. */
  configured(): boolean;
  listCompetitions(sport: SportKey): Promise<CompetitionRef[]>;
  listTeams(competition: CompetitionRef, season: string): Promise<TeamRef[]>;
  /** Events in the window, with results for the finished ones. */
  listEvents(competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]>;
  /** Every event of past seasons, for backfills and backtests. */
  listHistory?(competition: CompetitionRef, seasons: string[]): Promise<EventRef[]>;
  getEventStats?(event: EventRef): Promise<EventStatsRef[]>;
  getLineups?(event: EventRef): Promise<LineupRef[]>;
  getInjuries?(competition: CompetitionRef, season: string): Promise<InjuryRef[]>;
  getStandings?(competition: CompetitionRef, season: string): Promise<StandingRow[]>;
}

/** Thrown when the provider refused the call; `retryable` says whether waiting helps. */
export class ProviderError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly provider: ProviderKey;
  constructor(provider: ProviderKey, message: string, status = 500, retryable = false) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Thrown when today's request budget for the provider is spent. */
export class BudgetExhaustedError extends ProviderError {
  constructor(provider: ProviderKey, budget: number) {
    super(provider, `Daily request budget for ${provider} (${budget}) is spent; resumes tomorrow.`, 429, false);
    this.name = 'BudgetExhaustedError';
  }
}

/** `2026-27` style label for a season that starts in `startYear`. */
export function seasonLabel(startYear: number, crossesYear = true): string {
  return crossesYear ? `${startYear}-${String(startYear + 1).slice(2)}` : String(startYear);
}

/** First calendar year of a season label (`2026-27` -> 2026, `2026` -> 2026). */
export function seasonStartYear(label: string): number {
  const match = /^(\d{4})/.exec(label);
  return match ? Number(match[1]) : new Date().getUTCFullYear();
}
