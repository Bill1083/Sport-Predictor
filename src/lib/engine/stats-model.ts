/**
 * Stat forecasts: passes, possession, shots, corners, cards and the rest.
 *
 * A ratio-of-averages model per stat: a side's expected value is the league
 * average scaled by its own rate (what it produces) and the opponent's
 * concession rate (what it allows), with a home factor. Team rates are
 * time-decayed and shrunk toward the league mean, so a team with two games
 * sits close to average until the evidence arrives. Counts get Poisson
 * intervals, continuous stats normal ones, percentages a symmetric band.
 */

import { decayWeight, daysBetween, normalQuantile, poissonQuantile } from '@/lib/engine/math';
import type { StatDefinition } from '@/lib/sports/registry';
import type { StatForecast, StatForecasts } from '@/lib/types';

export interface StatSample {
  team: string;
  opponent: string;
  home: boolean;
  date: Date;
  stats: Record<string, number>;
}

export interface StatParams {
  xi: number;
  /** Pseudo-observations pulling a team's rate to the league mean. */
  shrink: number;
  maxAgeDays: number;
}

export const DEFAULT_STAT_PARAMS: StatParams = { xi: 0.003, shrink: 4, maxAgeDays: 730 };

interface Acc {
  sum: number;
  sumSq: number;
  weight: number;
}

export interface StatState {
  /** League mean for the home side and the away side, per stat. */
  leagueHome: Record<string, number>;
  leagueAway: Record<string, number>;
  /** Residual standard deviation per stat around the team-adjusted expectation. */
  sd: Record<string, number>;
  /** Team rate multipliers (for) and concession multipliers (against). */
  teamFor: Record<string, Record<string, number>>;
  teamAgainst: Record<string, Record<string, number>>;
  samples: number;
  fittedAt: string;
}

function acc(map: Map<string, Acc>, key: string, value: number, weight: number): void {
  const entry = map.get(key) ?? { sum: 0, sumSq: 0, weight: 0 };
  entry.sum += value * weight;
  entry.sumSq += value * value * weight;
  entry.weight += weight;
  map.set(key, entry);
}

export function fitStats(samples: StatSample[], statKeys: string[], asOf: Date, params: StatParams = DEFAULT_STAT_PARAMS): StatState {
  const usable = samples.filter((s) => s.date < asOf && daysBetween(s.date, asOf) <= params.maxAgeDays);
  const leagueHome = new Map<string, Acc>();
  const leagueAway = new Map<string, Acc>();
  const forAcc = new Map<string, Acc>(); // `${team}|${stat}`
  const againstAcc = new Map<string, Acc>();
  for (const sample of usable) {
    const w = decayWeight(daysBetween(sample.date, asOf), params.xi);
    for (const key of statKeys) {
      const value = sample.stats[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      acc(sample.home ? leagueHome : leagueAway, key, value, w);
      acc(forAcc, `${sample.team}|${key}`, value, w);
      acc(againstAcc, `${sample.opponent}|${key}`, value, w);
    }
  }
  const meanOf = (map: Map<string, Acc>, key: string): number | undefined => {
    const entry = map.get(key);
    return entry && entry.weight > 0 ? entry.sum / entry.weight : undefined;
  };
  const league: Record<string, number> = {};
  const state: StatState = { leagueHome: {}, leagueAway: {}, sd: {}, teamFor: {}, teamAgainst: {}, samples: usable.length, fittedAt: new Date().toISOString() };
  for (const key of statKeys) {
    const h = meanOf(leagueHome, key);
    const a = meanOf(leagueAway, key);
    if (h === undefined && a === undefined) continue;
    state.leagueHome[key] = h ?? (a as number);
    state.leagueAway[key] = a ?? (h as number);
    league[key] = (state.leagueHome[key] + state.leagueAway[key]) / 2;
    const all = leagueHome.get(key);
    const allAway = leagueAway.get(key);
    const weight = (all?.weight ?? 0) + (allAway?.weight ?? 0);
    const sum = (all?.sum ?? 0) + (allAway?.sum ?? 0);
    const sumSq = (all?.sumSq ?? 0) + (allAway?.sumSq ?? 0);
    const variance = weight > 1 ? Math.max(0, sumSq / weight - (sum / weight) ** 2) : 0;
    state.sd[key] = Math.sqrt(variance);
  }
  const teams = new Set(usable.flatMap((s) => [s.team, s.opponent]));
  for (const team of teams) {
    state.teamFor[team] = {};
    state.teamAgainst[team] = {};
    for (const key of statKeys) {
      const avg = league[key];
      if (avg === undefined) continue;
      const f = forAcc.get(`${team}|${key}`);
      const g = againstAcc.get(`${team}|${key}`);
      // Shrunk rate: (sum + shrink*avg) / (weight + shrink), as a multiplier of the league mean.
      const forRate = f ? (f.sum + params.shrink * avg) / (f.weight + params.shrink) : avg;
      const againstRate = g ? (g.sum + params.shrink * avg) / (g.weight + params.shrink) : avg;
      state.teamFor[team][key] = avg > 0 ? forRate / avg : 1;
      state.teamAgainst[team][key] = avg > 0 ? againstRate / avg : 1;
    }
  }
  return state;
}

function interval(def: StatDefinition, mean: number, sd: number): StatForecast {
  if (def.distribution === 'poisson' || def.distribution === 'count') {
    const lambda = Math.max(0.01, mean);
    return { mean, low: poissonQuantile(0.1, lambda), high: poissonQuantile(0.9, lambda) };
  }
  if (def.distribution === 'percent') {
    const band = Math.max(3, Math.min(12, sd * 1.28 || 8));
    return { mean, low: Math.max(0, mean - band), high: Math.min(100, mean + band) };
  }
  const z = normalQuantile(0.9);
  return { mean, low: Math.max(0, mean - z * sd), high: mean + z * sd };
}

/** Expected stats for both sides of a fixture. */
export function forecastStats(state: StatState, home: string, away: string, defs: StatDefinition[]): StatForecasts {
  const out: StatForecasts = {};
  for (const def of defs) {
    const key = def.key;
    const lh = state.leagueHome[key];
    const la = state.leagueAway[key];
    if (lh === undefined || la === undefined) continue;
    const hf = state.teamFor[home]?.[key] ?? 1;
    const ha = state.teamAgainst[home]?.[key] ?? 1;
    const af = state.teamFor[away]?.[key] ?? 1;
    const aa = state.teamAgainst[away]?.[key] ?? 1;
    let homeMean: number;
    let awayMean: number;
    if (def.distribution === 'percent' && key === 'possession') {
      // Possession is zero-sum: combine each side's edge over 50 and split.
      const edge = ((hf - 1) * lh - (af - 1) * la) / 2 + (lh - 50);
      homeMean = Math.max(25, Math.min(75, 50 + edge));
      awayMean = 100 - homeMean;
    } else if (def.distribution === 'percent') {
      // Accuracy-type stats: mostly the team's own habit, nudged by opponent pressure.
      homeMean = Math.max(0, Math.min(100, lh * hf * Math.sqrt(aa)));
      awayMean = Math.max(0, Math.min(100, la * af * Math.sqrt(ha)));
    } else {
      homeMean = lh * hf * aa;
      awayMean = la * af * ha;
    }
    const decimals = 10 ** def.decimals;
    const r = (v: number) => Math.round(v * decimals) / decimals;
    const sd = state.sd[key] ?? Math.sqrt(Math.max(0.1, homeMean));
    const h = interval(def, homeMean, sd);
    const a = interval(def, awayMean, sd);
    out[key] = {
      home: { mean: r(h.mean), low: r(h.low), high: r(h.high) },
      away: { mean: r(a.mean), low: r(a.low), high: r(a.high) },
    };
  }
  return out;
}
