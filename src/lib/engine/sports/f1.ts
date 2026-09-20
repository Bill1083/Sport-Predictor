/**
 * The Formula 1 race model.
 *
 * Each driver's pace is a time-decayed average of a finishing score over
 * recent races (a win scores 20, twentieth scores 1, a retirement scores
 * nothing for pace but counts toward the retirement rate). Once qualifying
 * is known, the grid position shifts pace by a configurable weight. A Monte
 * Carlo then runs the race thousands of times: each driver gets pace plus
 * noise, retires with their own probability, and the order gives win,
 * podium, points and expected finishing position for everyone.
 */

import { decayWeight, daysBetween } from '@/lib/engine/math';
import { rng } from '@/lib/providers/mock/generator';
import type { ProbMap } from '@/lib/types';

export interface RaceEntrant {
  teamId: string;
  name: string;
  gridPosition: number | null;
}

export interface PastRace {
  date: Date;
  results: { teamId: string; finishPosition: number | null; gridPosition: number | null; statusNote: string | null }[];
}

export interface RaceParams {
  xi: number;
  runs: number;
  gridWeight: number;
  noise: number;
}

export const DEFAULT_RACE_PARAMS: RaceParams = { xi: 0.006, runs: 5_000, gridWeight: 0.6, noise: 0.35 };

export interface EntrantForecast {
  teamId: string;
  name: string;
  win: number;
  podium: number;
  points: number;
  expectedPosition: number;
  dnf: number;
  pace: number;
}

export interface RaceForecast {
  probs: ProbMap;
  entrants: EntrantForecast[];
  runs: number;
}

const FIELD = 20;

function isFinish(status: string | null): boolean {
  return status === null || status === 'Finished' || /^\+\d+ Laps?$/.test(status);
}

/** Pace and retirement rate per driver from past races before `asOf`. */
export function fitPace(history: PastRace[], asOf: Date, xi: number): Map<string, { pace: number; dnf: number; races: number }> {
  const acc = new Map<string, { score: number; weight: number; dnfs: number; starts: number }>();
  for (const race of history) {
    if (race.date >= asOf) continue;
    const w = decayWeight(daysBetween(race.date, asOf), xi);
    for (const r of race.results) {
      const entry = acc.get(r.teamId) ?? { score: 0, weight: 0, dnfs: 0, starts: 0 };
      entry.starts += w;
      if (isFinish(r.statusNote) && r.finishPosition) {
        entry.score += w * Math.max(1, FIELD + 1 - r.finishPosition);
        entry.weight += w;
      } else {
        entry.dnfs += w;
      }
      acc.set(r.teamId, entry);
    }
  }
  const out = new Map<string, { pace: number; dnf: number; races: number }>();
  // Shrink thin samples toward a midfield pace and the field's retirement rate.
  const PRIOR_PACE = 8;
  const PRIOR_WEIGHT = 2;
  const PRIOR_DNF = 0.12;
  for (const [teamId, e] of acc) {
    out.set(teamId, {
      pace: (e.score + PRIOR_PACE * PRIOR_WEIGHT) / (e.weight + PRIOR_WEIGHT),
      dnf: Math.min(0.5, (e.dnfs + PRIOR_DNF * PRIOR_WEIGHT) / (e.starts + PRIOR_WEIGHT)),
      races: e.starts,
    });
  }
  return out;
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function simulateRace(entrants: RaceEntrant[], history: PastRace[], asOf: Date, params: RaceParams = DEFAULT_RACE_PARAMS): RaceForecast {
  const fitted = fitPace(history, asOf, params.xi);
  const n = entrants.length;
  if (n === 0) return { probs: {}, entrants: [], runs: 0 };
  const base = entrants.map((e) => {
    const f = fitted.get(e.teamId) ?? { pace: 8, dnf: 0.12, races: 0 };
    const gridScore = e.gridPosition ? Math.max(1, FIELD + 1 - e.gridPosition) : null;
    // Pace in "finishing score" units; the grid pulls it toward the qualifying position.
    const pace = gridScore !== null ? (1 - params.gridWeight) * f.pace + params.gridWeight * gridScore : f.pace;
    return { pace, dnf: f.dnf };
  });
  const spread = params.noise * FIELD * 0.5;
  const wins = new Array<number>(n).fill(0);
  const podiums = new Array<number>(n).fill(0);
  const points = new Array<number>(n).fill(0);
  const positionSum = new Array<number>(n).fill(0);
  const dnfs = new Array<number>(n).fill(0);
  const random = rng(0xf1 + n * 7 + Math.round(asOf.getTime() / 86_400_000));
  const order = entrants.map((_, i) => i);
  const sample = new Array<number>(n);
  const retired = new Array<boolean>(n);
  for (let run = 0; run < params.runs; run += 1) {
    for (let i = 0; i < n; i += 1) {
      retired[i] = random() < base[i].dnf;
      sample[i] = base[i].pace + gaussian(random) * spread;
    }
    order.sort((a, b) => {
      if (retired[a] !== retired[b]) return retired[a] ? 1 : -1;
      return sample[b] - sample[a];
    });
    for (let pos = 0; pos < n; pos += 1) {
      const i = order[pos];
      positionSum[i] += pos + 1;
      if (retired[i]) dnfs[i] += 1;
      if (pos === 0) wins[i] += 1;
      if (pos < 3) podiums[i] += 1;
      if (pos < 10) points[i] += 1;
    }
  }
  const probs: ProbMap = {};
  const forecasts: EntrantForecast[] = entrants.map((e, i) => {
    const win = wins[i] / params.runs;
    probs[e.teamId] = Math.round(win * 10_000) / 10_000;
    return {
      teamId: e.teamId,
      name: e.name,
      win,
      podium: podiums[i] / params.runs,
      points: points[i] / params.runs,
      expectedPosition: Math.round((positionSum[i] / params.runs) * 10) / 10,
      dnf: dnfs[i] / params.runs,
      pace: Math.round(base[i].pace * 100) / 100,
    };
  });
  forecasts.sort((a, b) => b.win - a.win || a.expectedPosition - b.expectedPosition);
  return { probs, entrants: forecasts, runs: params.runs };
}
