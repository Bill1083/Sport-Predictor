/**
 * Scoreline distributions from a pair of goal rates.
 *
 * Two independent Poissons, optionally with the Dixon-Coles low-score
 * correction (rho) that fixes the draw under-prediction of the plain model.
 * Everything a match page shows about the score comes from this grid:
 * 1X2, exact scores, totals, both-to-score, clean sheets.
 */

import { poissonPmf } from '@/lib/engine/math';
import type { ProbMap, ScoreForecast } from '@/lib/types';

/** Dixon-Coles dependence factor for the four low scorelines. */
export function tau(x: number, y: number, lambda: number, mu: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/** grid[home][away] = P(home scores `home`, away scores `away`), renormalised. */
export function scoreGrid(lambdaHome: number, lambdaAway: number, rho = 0, maxGoals = 10): number[][] {
  const grid: number[][] = [];
  let total = 0;
  for (let h = 0; h <= maxGoals; h += 1) {
    const row: number[] = [];
    for (let a = 0; a <= maxGoals; a += 1) {
      const p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway) * Math.max(0, tau(h, a, lambdaHome, lambdaAway, rho));
      row.push(p);
      total += p;
    }
    grid.push(row);
  }
  if (total > 0) for (const row of grid) for (let i = 0; i < row.length; i += 1) row[i] /= total;
  return grid;
}

export function gridOutcomes(grid: number[][]): ProbMap {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h < grid.length; h += 1) {
    for (let a = 0; a < grid[h].length; a += 1) {
      if (h > a) home += grid[h][a];
      else if (h === a) draw += grid[h][a];
      else away += grid[h][a];
    }
  }
  return { HOME: home, DRAW: draw, AWAY: away };
}

/** Totals, both-to-score and clean-sheet probabilities. */
export function gridLines(grid: number[][]): Record<string, number> {
  let over15 = 0;
  let over25 = 0;
  let over35 = 0;
  let btts = 0;
  let homeCleanSheet = 0;
  let awayCleanSheet = 0;
  for (let h = 0; h < grid.length; h += 1) {
    for (let a = 0; a < grid[h].length; a += 1) {
      const p = grid[h][a];
      const total = h + a;
      if (total > 1.5) over15 += p;
      if (total > 2.5) over25 += p;
      if (total > 3.5) over35 += p;
      if (h > 0 && a > 0) btts += p;
      if (a === 0) homeCleanSheet += p;
      if (h === 0) awayCleanSheet += p;
    }
  }
  return { over15, over25, over35, btts, homeCleanSheet, awayCleanSheet };
}

export function topScorelines(grid: number[][], n = 6): { home: number; away: number; p: number }[] {
  const list: { home: number; away: number; p: number }[] = [];
  for (let h = 0; h < grid.length; h += 1) for (let a = 0; a < grid[h].length; a += 1) list.push({ home: h, away: a, p: grid[h][a] });
  return list.sort((x, y) => y.p - x.p).slice(0, n);
}

export function scoreForecastFromGrid(grid: number[][], lambdaHome: number, lambdaAway: number, keepGrid = 6): ScoreForecast {
  const top = topScorelines(grid, 8);
  return {
    expected: { home: round2(lambdaHome), away: round2(lambdaAway) },
    mostLikely: { home: top[0].home, away: top[0].away, p: round4(top[0].p) },
    top: top.map((t) => ({ ...t, p: round4(t.p) })),
    grid: grid.slice(0, keepGrid).map((row) => row.slice(0, keepGrid).map(round4)),
    lines: Object.fromEntries(Object.entries(gridLines(grid)).map(([k, v]) => [k, round4(v)])),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}
