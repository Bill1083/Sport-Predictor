import { describe, expect, it } from 'vitest';

import { mapMatch as mapCricket, mapStatus as cricketStatus } from '@/lib/providers/cricketdata';
import { mapMatch as mapEspn, mapStatus as espnStatus } from '@/lib/providers/espn-tennis';
import { parseScore, rowToEvent, rowToStats, sidesFor } from '@/lib/providers/tennis-archive';

describe('tennis archive', () => {
  const row = {
    tourney_id: '2026-9900',
    tourney_name: 'United Cup',
    surface: 'Hard',
    tourney_date: '20260105',
    match_num: '400',
    tourney_level: 'A',
    winner_id: '128034',
    winner_name: 'Hubert Hurkacz',
    winner_ioc: 'POL',
    loser_id: '104527',
    loser_name: 'Stan Wawrinka',
    loser_ioc: 'SUI',
    score: '6-3 3-6 7-6(4)',
    best_of: '3',
    round: 'F',
    minutes: '114',
    w_ace: '18',
    w_df: '0',
    w_svpt: '90',
    w_1stIn: '63',
    w_bpSaved: '8',
    w_bpFaced: '9',
    l_ace: '10',
    l_df: '1',
    l_svpt: '78',
    l_1stIn: '49',
    l_bpSaved: '5',
    l_bpFaced: '7',
  };

  it('parses scores including tiebreaks and retirements', () => {
    expect(parseScore('6-3 3-6 7-6(4)')).toEqual({ sets: [2, 1], games: [16, 15], retired: false });
    expect(parseScore('6-4 2-1 RET')).toEqual({ sets: [1, 0], games: [8, 5], retired: true });
    expect(parseScore('W/O')).toEqual({ sets: [0, 0], games: [0, 0], retired: true });
  });

  it('files the pairing the same way round whoever won', () => {
    expect(sidesFor('Hubert Hurkacz', 'Stan Wawrinka')).toBe(true);
    expect(sidesFor('Stan Wawrinka', 'Hubert Hurkacz')).toBe(false);
    const event = rowToEvent(row, 'atp')!;
    expect(event.home.name).toBe('Hubert Hurkacz');
    expect(event.away.name).toBe('Stan Wawrinka');
    expect(event.result).toMatchObject({ homeScore: 2, awayScore: 1, winner: 'HOME' });
    const swapped = rowToEvent({ ...row, winner_name: 'Stan Wawrinka', winner_id: '104527', loser_name: 'Hubert Hurkacz', loser_id: '128034' }, 'atp')!;
    expect(swapped.home.name).toBe('Hubert Hurkacz');
    expect(swapped.result?.winner).toBe('AWAY');
  });

  it('dates the final six days after the tournament start and records the format', () => {
    const event = rowToEvent(row, 'atp')!;
    expect(event.startsAt.toISOString()).toBe('2026-01-11T12:00:00.000Z');
    expect(event.format).toBe('Hard BO3');
    expect(event.season).toBe('2026');
    expect(event.externalId).toBe('2026-9900:400');
    expect(event.home.kind).toBe('PLAYER');
    expect(rowToEvent({ ...row, tourney_date: '' }, 'atp')).toBeNull();
  });

  it('turns serve columns into the stat keys the sport defines', () => {
    const event = rowToEvent(row, 'atp')!;
    const stats = rowToStats(row, event);
    expect(stats).toHaveLength(2);
    expect(stats[0].teamExternalId).toBe('128034');
    expect(stats[0].stats).toMatchObject({ sets: 2, games: 16, aces: 18, doubleFaults: 0, firstServePct: 70, breakPointsWon: 2 });
    expect(stats[1].stats).toMatchObject({ sets: 1, games: 15, aces: 10, breakPointsWon: 1 });
  });
});

describe('ESPN tennis', () => {
  const tournament = { id: '189-2026', name: 'US Open', date: '2026-08-24T04:00Z', season: { year: 2026 }, venue: { fullName: 'New York, USA' } };
  const match = {
    id: '184607',
    date: '2026-08-24T15:05Z',
    status: { type: { state: 'post', completed: true, name: 'STATUS_FINAL' } },
    format: { regulation: { periods: 5 } },
    competitors: [
      { id: '2012', homeAway: 'away', winner: false, linescores: [{ value: 6, tiebreak: 3, winner: false }, { value: 3, winner: false }], athlete: { displayName: 'Roberto Carballes Baena', shortName: 'R. Carballes Baena', flag: { alt: 'Spain' } } },
      { id: '11685', homeAway: 'home', winner: true, linescores: [{ value: 7, tiebreak: 7, winner: true }, { value: 6, winner: true }], athlete: { displayName: 'Jacob Fearnley', shortName: 'J. Fearnley', flag: { alt: 'Great Britain' } } },
    ],
  };

  it('maps a completed singles match with sets and games', () => {
    const ref = mapEspn('atp', tournament, "Men's Singles", match)!;
    expect(ref.status).toBe('FINISHED');
    expect(ref.home.name).toBe('Jacob Fearnley');
    expect(ref.away.name).toBe('Roberto Carballes Baena');
    expect(ref.result).toMatchObject({ homeScore: 2, awayScore: 0, winner: 'HOME', extra: { games: [13, 9] } });
    expect(ref.format).toBe('BO5');
    expect(ref.round).toBe("US Open Men's Singles");
    expect(ref.season).toBe('2026');
    expect(ref.startsAt.toISOString()).toBe('2026-08-24T15:05:00.000Z');
  });

  it('keeps scheduled matches without a result and skips doubles', () => {
    const scheduled = mapEspn('atp', tournament, '', { ...match, status: { type: { state: 'pre', completed: false, name: 'STATUS_SCHEDULED' } }, competitors: match.competitors.map((c) => ({ ...c, winner: false, linescores: [] })) })!;
    expect(scheduled.status).toBe('SCHEDULED');
    expect(scheduled.result).toBeUndefined();
    expect(mapEspn('atp', tournament, '', { ...match, competitors: [{ id: '1' }, { id: '2' }] })).toBeNull();
    expect(espnStatus('in', false, undefined)).toBe('LIVE');
    expect(espnStatus('pre', false, 'STATUS_POSTPONED')).toBe('POSTPONED');
  });
});

describe('cricketdata', () => {
  const base = {
    id: 'm1',
    name: 'England vs Australia, 1st Test',
    matchType: 'test',
    venue: "Lord's, London",
    dateTimeGMT: '2026-06-10T10:00:00',
    teams: ['England', 'Australia'],
    teamInfo: [
      { name: 'England', shortname: 'ENG' },
      { name: 'Australia', shortname: 'AUS' },
    ],
  };

  it('reads the winner from the status text and runs from the innings', () => {
    const ref = mapCricket(
      { ...base, status: 'Australia won by 5 wickets', matchStarted: true, matchEnded: true, score: [{ r: 250, w: 10, o: 80, inning: 'England Inning 1' }, { r: 300, w: 10, o: 90, inning: 'Australia Inning 1' }, { r: 180, w: 10, o: 60, inning: 'England Inning 2' }, { r: 131, w: 5, o: 30, inning: 'Australia Inning 2' }] },
      's1',
      '2026',
    )!;
    expect(ref.status).toBe('FINISHED');
    expect(ref.result).toMatchObject({ homeScore: 430, awayScore: 431, winner: 'AWAY' });
    expect(ref.format).toBe('TEST');
    expect(ref.round).toBe('1st Test');
    expect(ref.home.shortName).toBe('ENG');
  });

  it('treats draws and no results as DRAW, and dates the start in UTC', () => {
    const drawn = mapCricket({ ...base, status: 'Match drawn', matchStarted: true, matchEnded: true }, 's1', '2026')!;
    expect(drawn.result?.winner).toBe('DRAW');
    expect(drawn.startsAt.toISOString()).toBe('2026-06-10T10:00:00.000Z');
    const upcoming = mapCricket({ ...base, status: 'Match not started' }, 's1', '2026', new Date('2026-06-01T00:00:00Z'))!;
    expect(upcoming.status).toBe('SCHEDULED');
    expect(upcoming.result).toBeUndefined();
    expect(cricketStatus({ ...base, matchStarted: true }, new Date('2026-06-10T12:00:00Z'))).toBe('LIVE');
    expect(cricketStatus({ ...base, status: 'Match not started' }, new Date('2026-07-01T00:00:00Z'))).toBe('CANCELLED');
    expect(mapCricket({ ...base, teams: ['England'] }, 's1', '2026')).toBeNull();
  });
});
