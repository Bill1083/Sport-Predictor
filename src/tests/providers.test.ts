import { describe, expect, it } from 'vitest';

import { mapFixture, mapStatistics, mapStatus as apiStatus } from '@/lib/providers/api-sports';
import { expandClubEloName, matchClubElo, parseClubElo } from '@/lib/providers/clubelo';
import { mapMatch, mapStatus as fdStatus } from '@/lib/providers/football-data';
import { parseCsv, parseDate, rowToEvent, rowToStats, seasonCode } from '@/lib/providers/football-data-co-uk';
import { describeCode, pickHour } from '@/lib/providers/open-meteo';
import { eventStart, mapEvent, tsdbSeason } from '@/lib/providers/thesportsdb';
import { curatedByProviderId, currentStartYear, seasonLabelFor } from '@/lib/sports/competitions';

describe('football-data.org mapping', () => {
  it('maps statuses and a finished match with its winner', () => {
    expect(fdStatus('FINISHED')).toBe('FINISHED');
    expect(fdStatus('IN_PLAY')).toBe('LIVE');
    expect(fdStatus('TIMED')).toBe('SCHEDULED');
    expect(fdStatus('POSTPONED')).toBe('POSTPONED');
    const ref = mapMatch(
      {
        id: 1,
        utcDate: '2026-09-20T14:00:00Z',
        status: 'FINISHED',
        matchday: 5,
        homeTeam: { id: 57, name: 'Arsenal FC', shortName: 'Arsenal', tla: 'ARS', crest: 'x.png' },
        awayTeam: { id: 61, name: 'Chelsea FC', shortName: 'Chelsea', tla: 'CHE' },
        score: { winner: 'HOME_TEAM', fullTime: { home: 2, away: 1 } },
        referees: [{ name: 'M Oliver' }],
      },
      'PL',
      '2026',
    );
    expect(ref.externalId).toBe('1');
    expect(ref.status).toBe('FINISHED');
    expect(ref.result).toEqual({ homeScore: 2, awayScore: 1, winner: 'HOME' });
    expect(ref.home.code).toBe('ARS');
    expect(ref.round).toBe('Matchday 5');
    expect(ref.referee).toBe('M Oliver');
  });
});

describe('API-Football mapping', () => {
  it('maps statuses, fixtures and the statistics block', () => {
    expect(apiStatus('FT')).toBe('FINISHED');
    expect(apiStatus('2H')).toBe('LIVE');
    expect(apiStatus('NS')).toBe('SCHEDULED');
    expect(apiStatus('PST')).toBe('POSTPONED');
    const ref = mapFixture({
      fixture: { id: 10, date: '2026-09-21T19:00:00+00:00', referee: 'A Ref', status: { short: 'FT', elapsed: 90 }, venue: { name: 'Anfield', city: 'Liverpool' } },
      league: { id: 39, season: 2026, round: 'Regular Season - 5' },
      teams: { home: { id: 40, name: 'Liverpool' }, away: { id: 33, name: 'Manchester United' } },
      goals: { home: 1, away: 1 },
    });
    expect(ref.result?.winner).toBe('DRAW');
    expect(ref.venue?.name).toBe('Anfield');
    expect(ref.competitionExternalId).toBe('39');
    const stats = mapStatistics(
      [
        {
          team: { id: 40, name: 'Liverpool' },
          statistics: [
            { type: 'Ball Possession', value: '61%' },
            { type: 'Total Shots', value: 14 },
            { type: 'Total passes', value: 612 },
            { type: 'Passes %', value: '88%' },
            { type: 'expected_goals', value: '1.73' },
            { type: 'Unknown thing', value: 3 },
            { type: 'Corner Kicks', value: null },
          ],
        },
      ],
      '10',
    );
    expect(stats[0].stats).toEqual({ possession: 61, shots: 14, passes: 612, passAccuracy: 88, xg: 1.73 });
  });
});

describe('TheSportsDB mapping', () => {
  it('reads the timestamp, scores and status', () => {
    const ref = mapEvent(
      { idEvent: '9', dateEvent: '2026-09-20', strTime: '15:00:00', strTimestamp: '2026-09-20T14:00:00', intRound: '5', idHomeTeam: '1', idAwayTeam: '2', strHomeTeam: 'A', strAwayTeam: 'B', intHomeScore: '3', intAwayScore: '0', strStatus: 'Match Finished' },
      '4328',
      '2026',
    );
    expect(ref?.startsAt.toISOString()).toBe('2026-09-20T14:00:00.000Z');
    expect(ref?.status).toBe('FINISHED');
    expect(ref?.result?.winner).toBe('HOME');
    expect(eventStart({ idEvent: 'x', dateEvent: '2026-01-02', strTime: null })?.toISOString()).toBe('2026-01-02T15:00:00.000Z');
    expect(tsdbSeason('2026', true)).toBe('2026-2027');
    expect(tsdbSeason('2026', false)).toBe('2026');
    expect(mapEvent({ idEvent: 'x', dateEvent: null }, '1', '2026')).toBeNull();
  });
});

describe('Football-Data.co.uk', () => {
  it('parses the CSV, dates, results and stats', () => {
    expect(seasonCode('2026')).toBe('2627');
    expect(parseDate('05/10/2025', '15:00')?.toISOString()).toBe('2025-10-05T15:00:00.000Z');
    expect(parseDate('05/10/25')?.toISOString()).toBe('2025-10-05T15:00:00.000Z');
    const csv = 'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,Referee,HS,AS,HST,AST,HC,AC,HF,AF,HY,AY,HR,AR\nE0,16/08/2025,12:30,Liverpool,Bournemouth,4,2,H,A Taylor,18,9,7,4,6,3,10,12,1,2,0,0\nE0,17/08/2025,14:00,Chelsea,Crystal Palace,,,,,,,,,,,,,,,,\n';
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    const event = rowToEvent(rows[0], 'E0', '2025')!;
    expect(event.status).toBe('FINISHED');
    expect(event.result).toEqual({ homeScore: 4, awayScore: 2, winner: 'HOME' });
    expect(event.home.name).toBe('Liverpool');
    const stats = rowToStats(rows[0], event);
    expect(stats[0].stats).toEqual({ goals: 4, shots: 18, shotsOnTarget: 7, corners: 6, fouls: 10, yellowCards: 1, redCards: 0 });
    expect(rowToEvent(rows[1], 'E0', '2025')?.status).toBe('SCHEDULED');
  });
});

describe('Open-Meteo', () => {
  it('picks the hour nearest kickoff and describes the code', () => {
    const forecast = {
      hourly: {
        time: ['2026-09-20T13:00', '2026-09-20T14:00', '2026-09-20T15:00'],
        temperature_2m: [16, 17.4, 18],
        precipitation_probability: [10, 35, 60],
        precipitation: [0, 0.2, 1.1],
        wind_speed_10m: [12, 14.5, 20],
        weather_code: [1, 61, 63],
      },
    };
    const w = pickHour(forecast, new Date('2026-09-20T14:10:00Z'));
    expect(w?.tempC).toBe(17.4);
    expect(w?.rainProb).toBe(35);
    expect(w?.conditions).toBe('rain');
    expect(describeCode(0)).toBe('clear');
    expect(pickHour(forecast, new Date('2026-09-25T14:00:00Z'))).toBeNull();
  });
});

describe('ClubElo', () => {
  it('parses the CSV and matches compact names', () => {
    const rows = parseClubElo('Rank,Club,Country,Level,Elo,From,To\n1,ManCity,ENG,1,2010.5,2026-09-20,2026-09-21\n2,Liverpool,ENG,1,1990.1,2026-09-20,2026-09-21\nNone,NottmForest,ENG,1,1750,2026-09-20,2026-09-21\n');
    expect(rows).toHaveLength(3);
    expect(rows[2].rank).toBeNull();
    expect(expandClubEloName('ManCity')).toBe('Man City');
    expect(expandClubEloName('NottmForest')).toBe("Nott'm Forest");
    const matched = matchClubElo(
      [
        { id: 'a', name: 'Manchester City FC' },
        { id: 'b', name: 'Liverpool FC' },
        { id: 'c', name: 'Nottingham Forest' },
        { id: 'd', name: 'Harbourside Athletic' },
      ],
      rows,
    );
    expect(matched.get('a')?.club).toBe('ManCity');
    expect(matched.get('b')?.club).toBe('Liverpool');
    expect(matched.get('c')?.club).toBe('NottmForest');
    expect(matched.has('d')).toBe(false);
  });
});

describe('curated catalogue', () => {
  it('links ids across providers and labels seasons', () => {
    expect(curatedByProviderId('football-data', 'PL')?.slug).toBe('england-premier-league');
    expect(curatedByProviderId('football-data-co-uk', 'E0')?.ids['api-sports']).toBe('39');
    expect(seasonLabelFor(2026, true)).toBe('2026-27');
    expect(seasonLabelFor(2026, false)).toBe('2026');
    expect(currentStartYear(new Date('2026-03-01T00:00:00Z'), true)).toBe(2025);
    expect(currentStartYear(new Date('2026-09-01T00:00:00Z'), true)).toBe(2026);
    expect(currentStartYear(new Date('2026-03-01T00:00:00Z'), false)).toBe(2026);
  });
});
