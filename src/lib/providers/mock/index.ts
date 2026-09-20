/**
 * The mock provider: serves the invented leagues from generator.ts through
 * the same interface as the real adapters, so every page, job and model can
 * be exercised with MOCK_SPORTS=true and no credentials.
 */

import { env } from '@/lib/env';
import type {
  Capability,
  CompetitionRef,
  DateRange,
  EventRef,
  EventStatsRef,
  InjuryRef,
  LineupRef,
  SportsDataProvider,
  StandingRow,
  TeamRef,
} from '@/lib/providers/provider';
import type { SportKey } from '@/lib/sports/registry';

import {
  MOCK_LEAGUES,
  currentSeasonYear,
  eventStats,
  injuries,
  lineups,
  seasonEvents,
  type MockLeague,
} from './generator';

function leagueFor(externalId: string): MockLeague | undefined {
  return MOCK_LEAGUES.find((league) => league.externalId === externalId);
}

export class MockProvider implements SportsDataProvider {
  readonly key = 'mock' as const;
  readonly label = 'Demo leagues';
  readonly sports: SportKey[] = ['football'];
  readonly capabilities: Capability[] = [
    'competitions',
    'teams',
    'fixtures',
    'results',
    'standings',
    'lineups',
    'injuries',
    'eventStats',
    'history',
    'crests',
  ];

  constructor(private readonly now: () => Date = () => new Date()) {}

  configured(): boolean {
    return env.mockSports;
  }

  async listCompetitions(sport: SportKey): Promise<CompetitionRef[]> {
    if (sport !== 'football') return [];
    const year = currentSeasonYear(this.now());
    return MOCK_LEAGUES.map((league) => ({
      externalId: league.externalId,
      name: league.name,
      shortName: league.shortName,
      country: league.country,
      type: 'LEAGUE',
      currentSeason: String(year),
      seasons: [year, year - 1, year - 2, year - 3].map(String),
      tier: 1,
    }));
  }

  async listTeams(competition: CompetitionRef): Promise<TeamRef[]> {
    const league = leagueFor(competition.externalId);
    if (!league) return [];
    const sample = seasonEvents(league, currentSeasonYear(this.now()), this.now());
    const seen = new Map<string, TeamRef>();
    for (const event of sample) {
      seen.set(event.home.externalId, event.home);
      seen.set(event.away.externalId, event.away);
    }
    return Array.from(seen.values());
  }

  async listEvents(competition: CompetitionRef, season: string, range: DateRange): Promise<EventRef[]> {
    const league = leagueFor(competition.externalId);
    if (!league) return [];
    return seasonEvents(league, Number(season), this.now()).filter(
      (event) => event.startsAt >= range.from && event.startsAt <= range.to,
    );
  }

  async listHistory(competition: CompetitionRef, seasons: string[]): Promise<EventRef[]> {
    const league = leagueFor(competition.externalId);
    if (!league) return [];
    const now = this.now();
    return seasons.flatMap((season) => seasonEvents(league, Number(season), now).filter((e) => e.status === 'FINISHED'));
  }

  async getEventStats(event: EventRef): Promise<EventStatsRef[]> {
    const league = leagueFor(event.competitionExternalId);
    return league ? eventStats(league, event) : [];
  }

  async getLineups(event: EventRef): Promise<LineupRef[]> {
    const league = leagueFor(event.competitionExternalId);
    return league ? lineups(league, event, this.now()) : [];
  }

  async getInjuries(competition: CompetitionRef): Promise<InjuryRef[]> {
    const league = leagueFor(competition.externalId);
    return league ? injuries(league, this.now()) : [];
  }

  async getStandings(competition: CompetitionRef, season: string): Promise<StandingRow[]> {
    const league = leagueFor(competition.externalId);
    if (!league) return [];
    const table = new Map<string, StandingRow>();
    for (const team of league.teams) {
      table.set(team.externalId, {
        teamExternalId: team.externalId,
        position: 0,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        scoredFor: 0,
        scoredAgainst: 0,
        points: 0,
      });
    }
    for (const event of seasonEvents(league, Number(season), this.now())) {
      if (event.status !== 'FINISHED' || !event.result) continue;
      const h = table.get(event.home.externalId) as StandingRow;
      const a = table.get(event.away.externalId) as StandingRow;
      const hs = event.result.homeScore ?? 0;
      const as = event.result.awayScore ?? 0;
      h.played += 1;
      a.played += 1;
      h.scoredFor += hs;
      h.scoredAgainst += as;
      a.scoredFor += as;
      a.scoredAgainst += hs;
      if (hs > as) {
        h.won += 1;
        a.lost += 1;
        h.points += 3;
      } else if (hs < as) {
        a.won += 1;
        h.lost += 1;
        a.points += 3;
      } else {
        h.drawn += 1;
        a.drawn += 1;
        h.points += 1;
        a.points += 1;
      }
    }
    return Array.from(table.values())
      .sort((x, y) => y.points - x.points || y.scoredFor - y.scoredAgainst - (x.scoredFor - x.scoredAgainst) || y.scoredFor - x.scoredFor)
      .map((row, index) => ({ ...row, position: index + 1 }));
  }
}
