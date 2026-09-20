/**
 * Curated competitions with their ids on every provider that serves them.
 * The catalogue sync seeds these first so the same league is one row no
 * matter which providers are configured; anything a provider offers beyond
 * this list is added under that provider's id alone.
 *
 * Football-Data.co.uk codes, football-data.org codes and The Odds API sport
 * keys are stable. The API-Sports and TheSportsDB ids are the well-known
 * ones; a wrong id would fetch the wrong league, so only ids that are
 * certain are listed and the rest are matched by name at sync time.
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

const football = (
  slug: string,
  name: string,
  country: string,
  type: CuratedCompetition['type'],
  tier: number,
  crossYear: boolean,
  ids: Partial<Record<ProviderKey, string>>,
  shortName?: string,
): CuratedCompetition => ({ sportKey: 'football', slug, name, shortName, country, type, tier, crossYear, ids });

export const CURATED: CuratedCompetition[] = [
  football('england-premier-league', 'Premier League', 'England', 'LEAGUE', 1, true, { 'football-data': 'PL', 'api-sports': '39', thesportsdb: '4328', 'football-data-co-uk': 'E0', 'odds-api': 'soccer_epl' }, 'PL'),
  football('england-championship', 'Championship', 'England', 'LEAGUE', 2, true, { 'football-data': 'ELC', 'api-sports': '40', thesportsdb: '4329', 'football-data-co-uk': 'E1', 'odds-api': 'soccer_efl_champ' }, 'ELC'),
  football('england-league-one', 'League One', 'England', 'LEAGUE', 3, true, { 'api-sports': '41', thesportsdb: '4396', 'football-data-co-uk': 'E2', 'odds-api': 'soccer_england_league1' }),
  football('england-league-two', 'League Two', 'England', 'LEAGUE', 4, true, { 'api-sports': '42', thesportsdb: '4397', 'football-data-co-uk': 'E3', 'odds-api': 'soccer_england_league2' }),
  football('england-fa-cup', 'FA Cup', 'England', 'CUP', 1, true, { 'api-sports': '45', 'odds-api': 'soccer_fa_cup' }),
  football('england-efl-cup', 'EFL Cup', 'England', 'CUP', 2, true, { 'api-sports': '48' }),
  football('scotland-premiership', 'Scottish Premiership', 'Scotland', 'LEAGUE', 1, true, { 'api-sports': '179', thesportsdb: '4330', 'football-data-co-uk': 'SC0', 'odds-api': 'soccer_spl' }, 'SPFL'),
  football('spain-la-liga', 'La Liga', 'Spain', 'LEAGUE', 1, true, { 'football-data': 'PD', 'api-sports': '140', thesportsdb: '4335', 'football-data-co-uk': 'SP1', 'odds-api': 'soccer_spain_la_liga' }, 'PD'),
  football('spain-segunda', 'Segunda Division', 'Spain', 'LEAGUE', 2, true, { 'api-sports': '141', 'football-data-co-uk': 'SP2' }),
  football('italy-serie-a', 'Serie A', 'Italy', 'LEAGUE', 1, true, { 'football-data': 'SA', 'api-sports': '135', thesportsdb: '4332', 'football-data-co-uk': 'I1', 'odds-api': 'soccer_italy_serie_a' }, 'SA'),
  football('italy-serie-b', 'Serie B', 'Italy', 'LEAGUE', 2, true, { 'api-sports': '136', 'football-data-co-uk': 'I2' }),
  football('germany-bundesliga', 'Bundesliga', 'Germany', 'LEAGUE', 1, true, { 'football-data': 'BL1', 'api-sports': '78', thesportsdb: '4331', 'football-data-co-uk': 'D1', 'odds-api': 'soccer_germany_bundesliga' }, 'BL1'),
  football('germany-2-bundesliga', '2. Bundesliga', 'Germany', 'LEAGUE', 2, true, { 'api-sports': '79', 'football-data-co-uk': 'D2' }),
  football('france-ligue-1', 'Ligue 1', 'France', 'LEAGUE', 1, true, { 'football-data': 'FL1', 'api-sports': '61', thesportsdb: '4334', 'football-data-co-uk': 'F1', 'odds-api': 'soccer_france_ligue_one' }, 'FL1'),
  football('france-ligue-2', 'Ligue 2', 'France', 'LEAGUE', 2, true, { 'api-sports': '62', 'football-data-co-uk': 'F2' }),
  football('netherlands-eredivisie', 'Eredivisie', 'Netherlands', 'LEAGUE', 1, true, { 'football-data': 'DED', 'api-sports': '88', thesportsdb: '4337', 'football-data-co-uk': 'N1', 'odds-api': 'soccer_netherlands_eredivisie' }, 'DED'),
  football('portugal-primeira-liga', 'Primeira Liga', 'Portugal', 'LEAGUE', 1, true, { 'football-data': 'PPL', 'api-sports': '94', thesportsdb: '4344', 'football-data-co-uk': 'P1', 'odds-api': 'soccer_portugal_primeira_liga' }, 'PPL'),
  football('belgium-pro-league', 'Belgian Pro League', 'Belgium', 'LEAGUE', 1, true, { 'api-sports': '144', 'football-data-co-uk': 'B1' }),
  football('turkey-super-lig', 'Super Lig', 'Turkey', 'LEAGUE', 1, true, { 'api-sports': '203', 'football-data-co-uk': 'T1' }),
  football('greece-super-league', 'Super League Greece', 'Greece', 'LEAGUE', 1, true, { 'api-sports': '197', 'football-data-co-uk': 'G1' }),
  football('europe-champions-league', 'UEFA Champions League', 'Europe', 'CUP', 1, true, { 'football-data': 'CL', 'api-sports': '2', thesportsdb: '4480', 'odds-api': 'soccer_uefa_champs_league' }, 'UCL'),
  football('europe-europa-league', 'UEFA Europa League', 'Europe', 'CUP', 1, true, { 'api-sports': '3', 'odds-api': 'soccer_uefa_europa_league' }, 'UEL'),
  football('brazil-serie-a', 'Brasileirao Serie A', 'Brazil', 'LEAGUE', 1, false, { 'football-data': 'BSA', 'api-sports': '71' }),
  football('usa-mls', 'MLS', 'USA', 'LEAGUE', 1, false, { 'api-sports': '253', thesportsdb: '4346', 'odds-api': 'soccer_usa_mls' }),
  football('world-cup', 'FIFA World Cup', 'World', 'INTERNATIONAL', 1, false, { 'football-data': 'WC', 'api-sports': '1' }),
  football('european-championship', 'UEFA European Championship', 'Europe', 'INTERNATIONAL', 1, false, { 'football-data': 'EC', 'api-sports': '4' }, 'Euros'),
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
