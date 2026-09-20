/**
 * Deterministic invented football leagues for MOCK_SPORTS=true.
 *
 * Two leagues, three past seasons of results plus the current season in
 * progress, realistic scorelines (each team has a hidden attack and defence
 * strength), team stats per match, a handful of injuries and lineups. All of
 * it is derived from a seeded PRNG keyed on the league, season and round, so
 * the same fixture always has the same result no matter when it is asked for.
 */

import type { EventRef, EventStatsRef, InjuryRef, LineupRef, TeamRef } from '@/lib/providers/provider';
import type { EventStatus } from '@/lib/types';

export interface MockLeague {
  externalId: string;
  name: string;
  shortName: string;
  country: string;
  teams: MockTeam[];
  /** Weekday (0 = Sunday) and hour the rounds are played. */
  matchday: { weekday: number; hour: number };
}

export interface MockTeam {
  externalId: string;
  name: string;
  shortName: string;
  code: string;
  city: string;
  stadium: string;
  lat: number;
  lon: number;
  attack: number;
  defence: number;
  colour: string;
}

function team(id: string, name: string, shortName: string, code: string, city: string, stadium: string, lat: number, lon: number, attack: number, defence: number, colour: string): MockTeam {
  return { externalId: id, name, shortName, code, city, stadium, lat, lon, attack, defence, colour };
}

export const NORTHERN: MockLeague = {
  externalId: 'mock-northern',
  name: 'Northern Premier Division',
  shortName: 'NPD',
  country: 'Demo',
  matchday: { weekday: 6, hour: 15 },
  teams: [
    team('npd-1', 'Harbourside Athletic', 'Harbourside', 'HAR', 'Harbourside', 'The Quay', 54.97, -1.6, 1.45, 0.72, '#2f6fd6'),
    team('npd-2', 'Kingsmoor Rovers', 'Kingsmoor', 'KGM', 'Kingsmoor', 'Moor Park', 53.8, -1.55, 1.35, 0.78, '#c0392b'),
    team('npd-3', 'Ashfield Town', 'Ashfield', 'ASH', 'Ashfield', 'Ash Lane', 53.48, -2.24, 1.2, 0.85, '#27ae60'),
    team('npd-4', 'Stonebridge City', 'Stonebridge', 'STB', 'Stonebridge', 'Bridge Road', 52.63, 1.3, 1.15, 0.9, '#8e44ad'),
    team('npd-5', 'Fernhill United', 'Fernhill', 'FER', 'Fernhill', 'Fern Park', 53.41, -2.98, 1.05, 0.95, '#d35400'),
    team('npd-6', 'Wexcombe Wanderers', 'Wexcombe', 'WEX', 'Wexcombe', 'The Meadow', 52.49, -1.89, 1.0, 1.0, '#16a085'),
    team('npd-7', 'Brackenford FC', 'Brackenford', 'BRK', 'Brackenford', 'Bracken Road', 51.45, -2.59, 0.95, 1.05, '#2c3e50'),
    team('npd-8', 'Millbrook Albion', 'Millbrook', 'MIL', 'Millbrook', 'Mill Lane', 50.9, -1.4, 0.9, 1.05, '#7f8c8d'),
    team('npd-9', 'Redcliffe Rangers', 'Redcliffe', 'RED', 'Redcliffe', 'Cliff Top', 54.58, -1.23, 0.88, 1.1, '#e74c3c'),
    team('npd-10', 'Oakhaven Villa', 'Oakhaven', 'OAK', 'Oakhaven', 'Oak Grove', 52.2, -0.9, 0.85, 1.15, '#f39c12'),
    team('npd-11', 'Thornbury Sports', 'Thornbury', 'THO', 'Thornbury', 'Thorn Field', 53.0, -2.18, 0.8, 1.2, '#1abc9c'),
    team('npd-12', 'Greywater Celtic', 'Greywater', 'GRY', 'Greywater', 'Grey Water Park', 55.86, -4.25, 0.75, 1.25, '#34495e'),
  ],
};

export const COASTAL: MockLeague = {
  externalId: 'mock-coastal',
  name: 'Coastal League',
  shortName: 'Coastal',
  country: 'Demo',
  matchday: { weekday: 0, hour: 14 },
  teams: [
    team('cst-1', 'Saltmarsh FC', 'Saltmarsh', 'SLT', 'Saltmarsh', 'Marsh Ground', 50.72, -1.88, 1.4, 0.75, '#0984e3'),
    team('cst-2', 'Port Ellery', 'Ellery', 'ELL', 'Port Ellery', 'Harbour View', 50.37, -4.14, 1.25, 0.82, '#d63031'),
    team('cst-3', 'Dunmere Town', 'Dunmere', 'DUN', 'Dunmere', 'Dune Park', 51.62, -3.94, 1.1, 0.9, '#00b894'),
    team('cst-4', 'Sandbay Athletic', 'Sandbay', 'SND', 'Sandbay', 'The Sands', 53.65, -3.0, 1.05, 0.95, '#e17055'),
    team('cst-5', 'Cliffhaven United', 'Cliffhaven', 'CLF', 'Cliffhaven', 'Haven Road', 51.13, 1.31, 1.0, 1.0, '#6c5ce7'),
    team('cst-6', 'Lighthouse Rovers', 'Lighthouse', 'LGT', 'Lighthouse', 'Beacon Park', 55.95, -3.19, 0.95, 1.02, '#fdcb6e'),
    team('cst-7', 'Tidewater Rangers', 'Tidewater', 'TDW', 'Tidewater', 'Tide Lane', 54.06, -2.8, 0.9, 1.08, '#00cec9'),
    team('cst-8', 'Seabrook Wanderers', 'Seabrook', 'SEA', 'Seabrook', 'Brook Field', 50.82, -0.14, 0.85, 1.12, '#b2bec3'),
    team('cst-9', 'Pebblewick Albion', 'Pebblewick', 'PEB', 'Pebblewick', 'Pebble Bank', 52.9, 1.6, 0.8, 1.18, '#636e72'),
    team('cst-10', 'Gullford City', 'Gullford', 'GUL', 'Gullford', 'The Nest', 51.4, -0.6, 0.78, 1.22, '#e84393'),
  ],
};

export const MOCK_LEAGUES: MockLeague[] = [NORTHERN, COASTAL];

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  const text = parts.join('|');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function poisson(lambda: number, random: () => number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= random();
  } while (p > limit);
  return k - 1;
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** Round-robin pairings (circle method), home and away. */
export function roundRobin(teams: MockTeam[]): [MockTeam, MockTeam][][] {
  const list = [...teams];
  const n = list.length;
  const rounds: [MockTeam, MockTeam][][] = [];
  for (let r = 0; r < n - 1; r += 1) {
    const round: [MockTeam, MockTeam][] = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = list[i];
      const b = list[n - 1 - i];
      // Alternate venues so nobody plays every round at home.
      round.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    list.splice(1, 0, list.pop() as MockTeam);
  }
  const reverse = rounds.map((round) => round.map(([h, a]) => [a, h] as [MockTeam, MockTeam]));
  return [...rounds, ...reverse];
}

/** Seasons run August to May. The season label is the starting year. */
export function seasonStart(year: number): Date {
  return new Date(Date.UTC(year, 7, 10, 0, 0, 0));
}

export function currentSeasonYear(now: Date): number {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 7 ? y : y - 1;
}

function kickoff(league: MockLeague, year: number, round: number): Date {
  const start = seasonStart(year);
  const first = new Date(start);
  while (first.getUTCDay() !== league.matchday.weekday) first.setUTCDate(first.getUTCDate() + 1);
  const date = new Date(first.getTime() + round * 7 * 86_400_000);
  date.setUTCHours(league.matchday.hour, 0, 0, 0);
  return date;
}

function teamRef(league: MockLeague, t: MockTeam): TeamRef {
  return {
    externalId: t.externalId,
    name: t.name,
    shortName: t.shortName,
    code: t.code,
    country: league.country,
    crestUrl: `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 4l24 8v20c0 14-10 24-24 28C18 56 8 46 8 32V12z" fill="${t.colour}"/><text x="32" y="40" font-family="Arial" font-size="20" font-weight="700" fill="#fff" text-anchor="middle">${t.code}</text></svg>`,
    )}`,
    venue: { name: t.stadium, city: t.city, country: league.country, lat: t.lat, lon: t.lon, capacity: 8_000 + (hashSeed(t.externalId) % 30_000) },
  };
}

/** Strength drifts a little season to season so tables are not identical. */
function strength(t: MockTeam, year: number): { attack: number; defence: number } {
  const random = rng(hashSeed('drift', t.externalId, year));
  const drift = (random() - 0.5) * 0.3;
  return { attack: Math.max(0.5, t.attack + drift), defence: Math.max(0.5, t.defence - drift / 2) };
}

const HOME_ADVANTAGE = 1.25;
const LEAGUE_GOALS = 1.35;

function simulate(league: MockLeague, year: number, round: number, home: MockTeam, away: MockTeam): { home: number; away: number; stats: Record<string, Record<string, number>> } {
  const random = rng(hashSeed('match', league.externalId, year, round, home.externalId, away.externalId));
  const h = strength(home, year);
  const a = strength(away, year);
  const lambdaHome = LEAGUE_GOALS * h.attack * a.defence * HOME_ADVANTAGE;
  const lambdaAway = LEAGUE_GOALS * a.attack * h.defence;
  const homeGoals = poisson(lambdaHome, random);
  const awayGoals = poisson(lambdaAway, random);
  const homeShare = 0.5 + 0.18 * (h.attack - a.attack) + 0.03;
  const possessionHome = Math.round(Math.min(72, Math.max(28, homeShare * 100 + gaussian(random) * 4)));
  const shotsHome = Math.max(2, Math.round(lambdaHome * 9 + gaussian(random) * 3));
  const shotsAway = Math.max(2, Math.round(lambdaAway * 9 + gaussian(random) * 3));
  const stats = (goals: number, shots: number, possession: number, attack: number): Record<string, number> => ({
    goals,
    xg: Math.round(Math.max(0.1, shots * 0.11 + gaussian(random) * 0.2) * 100) / 100,
    possession,
    shots,
    shotsOnTarget: Math.max(goals, Math.round(shots * (0.3 + attack * 0.05) + gaussian(random))),
    passes: Math.round(300 + possession * 4.2 + attack * 40 + gaussian(random) * 40),
    passAccuracy: Math.round(Math.min(92, Math.max(62, 70 + attack * 8 + possession * 0.1 + gaussian(random) * 3))),
    corners: Math.max(0, Math.round(shots * 0.4 + gaussian(random) * 1.5)),
    fouls: Math.max(2, Math.round(11 + gaussian(random) * 3)),
    yellowCards: Math.max(0, Math.round(1.8 + gaussian(random) * 1.2)),
    redCards: random() < 0.06 ? 1 : 0,
    offsides: Math.max(0, Math.round(2 + gaussian(random) * 1.5)),
  });
  return {
    home: homeGoals,
    away: awayGoals,
    stats: {
      [home.externalId]: stats(homeGoals, shotsHome, possessionHome, h.attack),
      [away.externalId]: stats(awayGoals, shotsAway, 100 - possessionHome, a.attack),
    },
  };
}

function statusFor(startsAt: Date, now: Date): EventStatus {
  const elapsed = now.getTime() - startsAt.getTime();
  if (elapsed < 0) return 'SCHEDULED';
  if (elapsed < 115 * 60_000) return 'LIVE';
  return 'FINISHED';
}

/** Every event of one league season, with results for the ones already played at `now`. */
export function seasonEvents(league: MockLeague, year: number, now: Date): EventRef[] {
  const rounds = roundRobin(league.teams);
  const events: EventRef[] = [];
  rounds.forEach((round, index) => {
    const base = kickoff(league, year, index);
    round.forEach(([home, away], slot) => {
      // Spread a round over the weekend: some on the day, a couple the day after.
      const offsetHours = slot % 3 === 2 ? 24 + 2 : slot % 3 === 1 ? 2.5 : 0;
      const startsAt = new Date(base.getTime() + offsetHours * 3_600_000);
      const status = statusFor(startsAt, now);
      const externalId = [league.externalId, year, `r${index + 1}`, home.externalId, away.externalId].join('__');
      const ref: EventRef = {
        externalId,
        competitionExternalId: league.externalId,
        season: String(year),
        round: `Round ${index + 1}`,
        startsAt,
        status,
        home: teamRef(league, home),
        away: teamRef(league, away),
        venue: teamRef(league, home).venue,
        referee: `Referee ${1 + (hashSeed(externalId) % 12)}`,
      };
      if (status !== 'SCHEDULED') {
        const sim = simulate(league, year, index, home, away);
        if (status === 'LIVE') {
          const minute = Math.min(90, Math.floor((now.getTime() - startsAt.getTime()) / 60_000));
          ref.minute = minute;
          ref.result = {
            homeScore: Math.round(sim.home * (minute / 90)),
            awayScore: Math.round(sim.away * (minute / 90)),
          };
        } else {
          ref.result = {
            homeScore: sim.home,
            awayScore: sim.away,
            winner: sim.home > sim.away ? 'HOME' : sim.home < sim.away ? 'AWAY' : 'DRAW',
          };
        }
      }
      events.push(ref);
    });
  });
  return events;
}

export function eventStats(league: MockLeague, ref: EventRef): EventStatsRef[] {
  if (ref.status !== 'FINISHED') return [];
  const parts = ref.externalId.split('__');
  if (parts.length !== 5 || parts[0] !== league.externalId) return [];
  const year = Number(parts[1]);
  const round = Number(parts[2].slice(1)) - 1;
  const home = league.teams.find((t) => t.externalId === parts[3]);
  const away = league.teams.find((t) => t.externalId === parts[4]);
  if (!home || !away) return [];
  const sim = simulate(league, year, round, home, away);
  return [home, away].map((t) => ({ eventExternalId: ref.externalId, teamExternalId: t.externalId, stats: sim.stats[t.externalId] }));
}

const POSITIONS = ['GK', 'RB', 'CB', 'CB', 'LB', 'DM', 'CM', 'AM', 'RW', 'ST', 'LW'];
const FIRST = ['Alex', 'Sam', 'Jordan', 'Casey', 'Morgan', 'Riley', 'Taylor', 'Jamie', 'Drew', 'Rowan', 'Ellis', 'Finley', 'Harley', 'Kai', 'Reese', 'Sasha', 'Bailey', 'Quinn'];
const LAST = ['Okafor', 'Nakamura', 'Lindqvist', 'Moreau', 'Silva', 'Haddad', 'Novak', 'Petrov', 'Byrne', 'Kowalski', 'Mensah', 'Rossi', 'Ivanova', 'Larsen', 'Dubois', 'Costa', 'Fischer', 'Walsh'];

export function squad(team: MockTeam): { name: string; position: string; number: number }[] {
  const random = rng(hashSeed('squad', team.externalId));
  const players: { name: string; position: string; number: number }[] = [];
  for (let i = 0; i < 18; i += 1) {
    const name = `${FIRST[Math.floor(random() * FIRST.length)]} ${LAST[Math.floor(random() * LAST.length)]}`;
    players.push({ name, position: POSITIONS[i % POSITIONS.length], number: i + 1 });
  }
  return players;
}

export function lineups(league: MockLeague, ref: EventRef, now: Date): LineupRef[] {
  const minutesToKickoff = (ref.startsAt.getTime() - now.getTime()) / 60_000;
  if (minutesToKickoff > 75) return [];
  return [ref.home, ref.away].map((side) => {
    const team = league.teams.find((t) => t.externalId === side.externalId) as MockTeam;
    const players = squad(team);
    return {
      eventExternalId: ref.externalId,
      teamExternalId: team.externalId,
      formation: '4-3-3',
      coach: `Coach ${team.shortName}`,
      starters: players.slice(0, 11),
      bench: players.slice(11),
      confirmed: true,
    };
  });
}

export function injuries(league: MockLeague, now: Date): InjuryRef[] {
  const week = Math.floor(now.getTime() / (7 * 86_400_000));
  const out: InjuryRef[] = [];
  for (const team of league.teams) {
    const random = rng(hashSeed('injury', team.externalId, week));
    const players = squad(team);
    const count = random() < 0.55 ? 1 : random() < 0.3 ? 2 : 0;
    for (let i = 0; i < count; i += 1) {
      const player = players[Math.floor(random() * 11)];
      out.push({
        teamExternalId: team.externalId,
        playerName: player.name,
        type: random() < 0.7 ? 'Injury' : 'Suspension',
        status: random() < 0.75 ? 'OUT' : 'DOUBTFUL',
        reason: random() < 0.5 ? 'Hamstring' : 'Knock',
        expectedReturn: new Date(now.getTime() + (7 + Math.floor(random() * 21)) * 86_400_000),
      });
    }
  }
  return out;
}
