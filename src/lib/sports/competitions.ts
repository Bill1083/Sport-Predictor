/**
 * Curated competitions with their ids on every provider that serves them.
 * The catalogue sync seeds these first so the same league is one row no
 * matter which providers are configured; anything a provider offers beyond
 * this list is added under that provider's id alone.
 *
 * Football-Data.co.uk codes and football-data.org codes are stable. The
 * API-Sports and TheSportsDB ids are the well-known ones; a wrong id would
 * fetch the wrong league, so only ids that are certain are listed and the
 * rest are matched by name at sync time.
 */

import type { ProviderKey } from '@/lib/providers/provider';
import type { SportKey } from '@/lib/sports/registry';

export interface CuratedCompetition {
  sportKey: SportKey;
  slug: string;
  name: string;
  shortName?: string;
  country: string;
  type: 'LEAGUE' | 'CUP' | 'INTERNATIONAL' | 'TOUR' | 'CHAMPIONSHIP';
  tier: number;
  /** Seasons cross the calendar year (Aug-May) rather than run within one. */
  crossYear: boolean;
  ids: Partial<Record<ProviderKey, string>>;
}

export const CURATED: CuratedCompetition[] = [
  { sportKey: 'football', slug: 'england-premier-league', name: 'Premier League', shortName: 'PL', country: 'England', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'football-data': 'PL', 'api-sports': '39', thesportsdb: '4328', 'football-data-co-uk': 'E0' } },
  { sportKey: 'football', slug: 'england-championship', name: 'Championship', shortName: 'ELC', country: 'England', type: 'LEAGUE', tier: 2, crossYear: true, ids: { 'football-data': 'ELC', 'api-sports': '40', thesportsdb: '4329', 'football-data-co-uk': 'E1' } },
  { sportKey: 'football', slug: 'england-league-one', name: 'League One', country: 'England', type: 'LEAGUE', tier: 3, crossYear: true, ids: { 'api-sports': '41', thesportsdb: '4396', 'football-data-co-uk': 'E2' } },
  { sportKey: 'football', slug: 'england-league-two', name: 'League Two', country: 'England', type: 'LEAGUE', tier: 4, crossYear: true, ids: { 'api-sports': '42', thesportsdb: '4397', 'football-data-co-uk': 'E3' } },
  { sportKey: 'football', slug: 'england-fa-cup', name: 'FA Cup', country: 'England', type: 'CUP', tier: 1, crossYear: true, ids: { 'api-sports': '45' } },
  { sportKey: 'football', slug: 'england-efl-cup', name: 'EFL Cup', country: 'England', type: 'CUP', tier: 2, crossYear: true, ids: { 'api-sports': '48' } },
  { sportKey: 'football', slug: 'scotland-premiership', name: 'Scottish Premiership', shortName: 'SPFL', country: 'Scotland', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'api-sports': '179', thesportsdb: '4330', 'football-data-co-uk': 'SC0' } },
  { sportKey: 'football', slug: 'spain-la-liga', name: 'La Liga', shortName: 'PD', country: 'Spain', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'football-data': 'PD', 'api-sports': '140', thesportsdb: '4335', 'football-data-co-uk': 'SP1' } },
  { sportKey: 'football', slug: 'spain-segunda', name: 'Segunda Division', country: 'Spain', type: 'LEAGUE', tier: 2, crossYear: true, ids: { 'api-sports': '141', 'football-data-co-uk': 'SP2' } },
  { sportKey: 'football', slug: 'italy-serie-a', name: 'Serie A', shortName: 'SA', country: 'Italy', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'football-data': 'SA', 'api-sports': '135', thesportsdb: '4332', 'football-data-co-uk': 'I1' } },
  { sportKey: 'football', slug: 'italy-serie-b', name: 'Serie B', country: 'Italy', type: 'LEAGUE', tier: 2, crossYear: true, ids: { 'api-sports': '136', 'football-data-co-uk': 'I2' } },
  { sportKey: 'football', slug: 'germany-bundesliga', name: 'Bundesliga', shortName: 'BL1', country: 'Germany', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'football-data': 'BL1', 'api-sports': '78', thesportsdb: '4331', 'football-data-co-uk': 'D1' } },
  { sportKey: 'football', slug: 'germany-2-bundesliga', name: '2. Bundesliga', country: 'Germany', type: 'LEAGUE', tier: 2, crossYear: true, ids: { 'api-sports': '79', 'football-data-co-uk': 'D2' } },
  { sportKey: 'football', slug: 'france-ligue-1', name: 'Ligue 1', shortName: 'FL1', country: 'France', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'football-data': 'FL1', 'api-sports': '61', thesportsdb: '4334', 'football-data-co-uk': 'F1' } },
  { sportKey: 'football', slug: 'france-ligue-2', name: 'Ligue 2', country: 'France', type: 'LEAGUE', tier: 2, crossYear: true, ids: { 'api-sports': '62', 'football-data-co-uk': 'F2' } },
  { sportKey: 'football', slug: 'netherlands-eredivisie', name: 'Eredivisie', shortName: 'DED', country: 'Netherlands', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'football-data': 'DED', 'api-sports': '88', thesportsdb: '4337', 'football-data-co-uk': 'N1' } },
  { sportKey: 'football', slug: 'portugal-primeira-liga', name: 'Primeira Liga', shortName: 'PPL', country: 'Portugal', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'football-data': 'PPL', 'api-sports': '94', thesportsdb: '4344', 'football-data-co-uk': 'P1' } },
  { sportKey: 'football', slug: 'belgium-pro-league', name: 'Belgian Pro League', country: 'Belgium', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'api-sports': '144', 'football-data-co-uk': 'B1' } },
  { sportKey: 'football', slug: 'turkey-super-lig', name: 'Super Lig', country: 'Turkey', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'api-sports': '203', 'football-data-co-uk': 'T1' } },
  { sportKey: 'football', slug: 'greece-super-league', name: 'Super League Greece', country: 'Greece', type: 'LEAGUE', tier: 1, crossYear: true, ids: { 'api-sports': '197', 'football-data-co-uk': 'G1' } },
  { sportKey: 'football', slug: 'europe-champions-league', name: 'UEFA Champions League', shortName: 'UCL', country: 'Europe', type: 'CUP', tier: 1, crossYear: true, ids: { 'football-data': 'CL', 'api-sports': '2', thesportsdb: '4480' } },
  { sportKey: 'football', slug: 'europe-europa-league', name: 'UEFA Europa League', shortName: 'UEL', country: 'Europe', type: 'CUP', tier: 1, crossYear: true, ids: { 'api-sports': '3' } },
  { sportKey: 'football', slug: 'brazil-serie-a', name: 'Brasileirao Serie A', country: 'Brazil', type: 'LEAGUE', tier: 1, crossYear: false, ids: { 'football-data': 'BSA', 'api-sports': '71' } },
  { sportKey: 'football', slug: 'usa-mls', name: 'MLS', country: 'USA', type: 'LEAGUE', tier: 1, crossYear: false, ids: { 'api-sports': '253', thesportsdb: '4346' } },
  { sportKey: 'football', slug: 'world-cup', name: 'FIFA World Cup', country: 'World', type: 'INTERNATIONAL', tier: 1, crossYear: false, ids: { 'football-data': 'WC', 'api-sports': '1' } },
  { sportKey: 'football', slug: 'european-championship', name: 'UEFA European Championship', shortName: 'Euros', country: 'Europe', type: 'INTERNATIONAL', tier: 1, crossYear: false, ids: { 'football-data': 'EC', 'api-sports': '4' } },
];

export function curatedFor(sportKey: SportKey): CuratedCompetition[] {
  return CURATED.filter((c) => c.sportKey === sportKey);
}

export function curatedByProviderId(provider: ProviderKey, externalId: string): CuratedCompetition | undefined {
  return CURATED.find((c) => c.ids[provider] === externalId);
}

/** Season label for a start year: "2026-27" for cross-year competitions, "2026" otherwise. */
export function seasonLabelFor(startYear: number, crossYear: boolean): string {
  return crossYear ? `${startYear}-${String(startYear + 1).slice(2)}` : String(startYear);
}

/** The start year of the season in progress on `now` for a competition shape. */
export function currentStartYear(now: Date, crossYear: boolean): number {
  const y = now.getUTCFullYear();
  if (!crossYear) return y;
  // Cross-year seasons start in July / August.
  return now.getUTCMonth() >= 6 ? y : y - 1;
}
