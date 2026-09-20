/**
 * Season simulation: play the remaining fixtures of a competition thousands
 * of times from the models' scoreline distributions and count where each
 * team finishes. Title, Europe and relegation probabilities, expected
 * points and expected position, all from one Monte Carlo pass.
 */

import { dcRates } from '@/lib/engine/dixon-coles';
import { eloPredict } from '@/lib/engine/elo';
import { scoreGrid } from '@/lib/engine/poisson';
import { prepareSportModels, type SportModels } from '@/lib/engine/predict';
import { prisma, withDatabase } from '@/lib/prisma';
import type { SportKey } from '@/lib/sports/registry';
import { buildTable, type TableRow } from '@/lib/standings';

export interface SimulatedTeam {
  teamId: string;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
  currentPoints: number;
  currentPosition: number;
  expectedPoints: number;
  expectedPosition: number;
  title: number;
  top: number;
  bottom: number;
  /** Probability of each finishing position, 1-based index. */
  positions: number[];
}

export interface Simulation {
  competitionId: string;
  season: string;
  runs: number;
  remaining: number;
  played: number;
  zones: { top: number; bottom: number };
  teams: SimulatedTeam[];
  computedAt: string;
}

interface Fixture {
  home: string;
  away: string;
  /** Flattened cumulative distribution over the score grid, row-major. */
  cdf: Float64Array;
  size: number;
}

const cache = new Map<string, { at: number; value: Simulation }>();
const CACHE_MS = 10 * 60_000;

function sampleScore(fixture: Fixture, random: () => number): { home: number; away: number } {
  const u = random();
  let lo = 0;
  let hi = fixture.cdf.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fixture.cdf[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return { home: Math.floor(lo / fixture.size), away: lo % fixture.size };
}

function fixtureFor(models: SportModels, competitionId: string, home: string, away: string, hasDraws: boolean): Fixture {
  const dc = models.dc.get(competitionId);
  let grid: number[][];
  if (dc) {
    const { lambdaHome, lambdaAway } = dcRates(dc, home, away);
    grid = scoreGrid(lambdaHome, lambdaAway, dc.rho, 8);
  } else {
    // No score model: turn Elo outcome probabilities into a coarse 1-0 / 0-0 / 0-1 grid.
    const p = eloPredict(models.elo, home, away, hasDraws);
    grid = [
      [p.DRAW ?? 0, p.AWAY ?? 0],
      [p.HOME ?? 0, 0],
    ];
  }
  const size = grid.length;
  const cdf = new Float64Array(size * size);
  let acc = 0;
  for (let h = 0; h < size; h += 1) {
    for (let a = 0; a < size; a += 1) {
      acc += grid[h][a];
      cdf[h * size + a] = acc;
    }
  }
  return { home, away, cdf, size };
}

/** mulberry32, seeded so a page reload shows the same numbers. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function simulateSeason(competitionId: string, runs = 3_000): Promise<Simulation | null> {
  const cached = cache.get(competitionId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const competition = await withDatabase(() => prisma.competition.findUnique({ where: { id: competitionId } }));
  if (!competition.ok || !competition.data || competition.data.type !== 'LEAGUE' || !competition.data.currentSeason) return null;
  const season = competition.data.currentSeason;
  const rows = await withDatabase(() =>
    prisma.event.findMany({
      where: { competitionId, season },
      include: {
        homeTeam: { select: { id: true, name: true, shortName: true, code: true, crestUrl: true } },
        awayTeam: { select: { id: true, name: true, shortName: true, code: true, crestUrl: true } },
      },
    }),
  );
  if (!rows.ok) return null;
  const events = rows.data.filter((e) => e.homeTeam && e.awayTeam);
  const current = buildTable(events);
  if (current.length < 4) return null;
  const remainingEvents = events.filter((e) => e.status === 'SCHEDULED' || e.status === 'POSTPONED');
  const models = await prepareSportModels(competition.data.sportKey as SportKey);
  if (!models) return null;

  const fixtures = remainingEvents.map((e) => fixtureFor(models, competitionId, e.homeTeamId as string, e.awayTeamId as string, models.sport.hasDraws));
  const n = current.length;
  const index = new Map(current.map((row, i) => [row.teamId, i]));
  const basePoints = current.map((row) => row.points);
  const baseGd = current.map((row) => row.scoredFor - row.scoredAgainst);
  const baseGf = current.map((row) => row.scoredFor);
  const positionCounts = current.map(() => new Array<number>(n).fill(0));
  const pointsSum = new Array<number>(n).fill(0);
  const random = rng(0x5c0ad + fixtures.length * 31 + Math.round(basePoints.reduce((s, p) => s + p, 0)));
  const points = new Array<number>(n);
  const gd = new Array<number>(n);
  const gf = new Array<number>(n);
  const order = current.map((_, i) => i);
  const win = models.sport.priors.homeAdvantage >= 0 ? 3 : 3;

  for (let run = 0; run < runs; run += 1) {
    for (let i = 0; i < n; i += 1) {
      points[i] = basePoints[i];
      gd[i] = baseGd[i];
      gf[i] = baseGf[i];
    }
    for (const fixture of fixtures) {
      const h = index.get(fixture.home);
      const a = index.get(fixture.away);
      if (h === undefined || a === undefined) continue;
      const score = sampleScore(fixture, random);
      gd[h] += score.home - score.away;
      gd[a] += score.away - score.home;
      gf[h] += score.home;
      gf[a] += score.away;
      if (score.home > score.away) points[h] += win;
      else if (score.home < score.away) points[a] += win;
      else {
        points[h] += 1;
        points[a] += 1;
      }
    }
    order.sort((x, y) => points[y] - points[x] || gd[y] - gd[x] || gf[y] - gf[x] || x - y);
    for (let pos = 0; pos < n; pos += 1) {
      positionCounts[order[pos]][pos] += 1;
      pointsSum[order[pos]] += points[order[pos]];
    }
  }

  const zones = { top: n >= 16 ? 4 : n >= 12 ? 3 : 2, bottom: n >= 18 ? 3 : 2 };
  const teams: SimulatedTeam[] = current.map((row, i) => {
    const positions = positionCounts[i].map((c) => c / runs);
    let expectedPosition = 0;
    positions.forEach((p, pos) => {
      expectedPosition += p * (pos + 1);
    });
    return {
      teamId: row.teamId,
      name: row.team.name,
      shortName: row.team.shortName,
      crestUrl: row.team.crestUrl,
      currentPoints: row.points,
      currentPosition: row.position,
      expectedPoints: Math.round((pointsSum[i] / runs) * 10) / 10,
      expectedPosition: Math.round(expectedPosition * 10) / 10,
      title: positions[0],
      top: positions.slice(0, zones.top).reduce((s, p) => s + p, 0),
      bottom: positions.slice(n - zones.bottom).reduce((s, p) => s + p, 0),
      positions,
    };
  });
  teams.sort((x, y) => x.expectedPosition - y.expectedPosition);
  const value: Simulation = {
    competitionId,
    season,
    runs,
    remaining: fixtures.length,
    played: events.filter((e) => e.status === 'FINISHED').length,
    zones,
    teams,
    computedAt: new Date().toISOString(),
  };
  cache.set(competitionId, { at: Date.now(), value });
  return value;
}

export function invalidateSimulation(competitionId?: string): void {
  if (competitionId) cache.delete(competitionId);
  else cache.clear();
}

export type { TableRow };
