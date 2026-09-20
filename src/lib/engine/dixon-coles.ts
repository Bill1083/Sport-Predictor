/**
 * Dixon-Coles (1997): each team has an attack and a defence strength, the
 * home side gets a home advantage, and a dependence parameter rho corrects
 * the four low scorelines. Fitted by maximum likelihood with exponential
 * time decay so recent matches count more, and a light L2 pull toward the
 * league average so a team with three games does not get an absurd rating.
 *
 *   log lambda = base + attack[home] + defence[away] + home
 *   log mu     = base + attack[away] + defence[home]
 *
 * with mean(attack) = mean(defence) = 0.
 */

import { decayWeight, daysBetween } from '@/lib/engine/math';
import { tau } from '@/lib/engine/poisson';

export interface DcMatch {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  date: Date;
}

export interface DcParams {
  /** Decay rate per day; 0.0018 halves a match's weight in about 385 days. */
  xi: number;
  maxIterations: number;
  /** Shrinkage on attack/defence toward zero. */
  l2: number;
  /** Ignore matches older than this many days. */
  maxAgeDays: number;
}

export const DEFAULT_DC_PARAMS: DcParams = { xi: 0.0018, maxIterations: 400, l2: 0.02, maxAgeDays: 1_200 };

export interface DcState {
  teams: string[];
  attack: Record<string, number>;
  defence: Record<string, number>;
  base: number;
  home: number;
  rho: number;
  matches: number;
  logLikelihood: number;
  fittedAt: string;
}

interface Row {
  h: number;
  a: number;
  x: number;
  y: number;
  w: number;
}

/** Fit on matches played before `asOf`. Returns a league-average state for tiny samples. */
export function fitDixonColes(matches: DcMatch[], asOf: Date, params: DcParams = DEFAULT_DC_PARAMS): DcState {
  const usable = matches.filter((m) => m.date < asOf && daysBetween(m.date, asOf) <= params.maxAgeDays);
  const teams = Array.from(new Set(usable.flatMap((m) => [m.home, m.away]))).sort();
  const index = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;
  const rows: Row[] = usable.map((m) => ({
    h: index.get(m.home) as number,
    a: index.get(m.away) as number,
    x: m.homeGoals,
    y: m.awayGoals,
    w: decayWeight(daysBetween(m.date, asOf), params.xi),
  }));
  const totalWeight = rows.reduce((s, r) => s + r.w, 0);
  const totalGoals = rows.reduce((s, r) => s + (r.x + r.y) * r.w, 0);
  const avgGoals = totalWeight > 0 ? totalGoals / (2 * totalWeight) : 1.3;

  const attack = new Array<number>(n).fill(0);
  const defence = new Array<number>(n).fill(0);
  let base = Math.log(Math.max(0.2, avgGoals));
  let home = 0.2;
  let rho = -0.05;

  if (rows.length < 10 || n < 2) {
    return finish(teams, attack, defence, base, home, rho, rows.length, 0);
  }

  const logLik = (att: number[], def: number[], b: number, hm: number, r: number): number => {
    let ll = 0;
    for (const row of rows) {
      const lambda = Math.exp(b + att[row.h] + def[row.a] + hm);
      const mu = Math.exp(b + att[row.a] + def[row.h]);
      const t = tau(row.x, row.y, lambda, mu, r);
      if (t <= 0) return Number.NEGATIVE_INFINITY;
      ll += row.w * (Math.log(t) + row.x * Math.log(lambda) - lambda + row.y * Math.log(mu) - mu);
    }
    for (let i = 0; i < n; i += 1) ll -= params.l2 * totalWeight * (att[i] ** 2 + def[i] ** 2) * 0.5;
    return ll;
  };

  let current = logLik(attack, defence, base, home, rho);
  let step = 0.5;
  const gAtt = new Array<number>(n);
  const gDef = new Array<number>(n);

  for (let iter = 0; iter < params.maxIterations; iter += 1) {
    gAtt.fill(0);
    gDef.fill(0);
    let gBase = 0;
    let gHome = 0;
    let gRho = 0;
    for (const row of rows) {
      const lambda = Math.exp(base + attack[row.h] + defence[row.a] + home);
      const mu = Math.exp(base + attack[row.a] + defence[row.h]);
      const t = tau(row.x, row.y, lambda, mu, rho);
      // d log(tau) / d lambda, d mu, d rho
      let dtl = 0;
      let dtm = 0;
      let dtr = 0;
      if (row.x === 0 && row.y === 0) {
        dtl = -mu * rho / t;
        dtm = -lambda * rho / t;
        dtr = -lambda * mu / t;
      } else if (row.x === 0 && row.y === 1) {
        dtl = rho / t;
        dtr = lambda / t;
      } else if (row.x === 1 && row.y === 0) {
        dtm = rho / t;
        dtr = mu / t;
      } else if (row.x === 1 && row.y === 1) {
        dtr = -1 / t;
      }
      const gl = row.w * (row.x - lambda + dtl * lambda);
      const gm = row.w * (row.y - mu + dtm * mu);
      gAtt[row.h] += gl;
      gDef[row.a] += gl;
      gAtt[row.a] += gm;
      gDef[row.h] += gm;
      gBase += gl + gm;
      gHome += gl;
      gRho += row.w * dtr;
    }
    for (let i = 0; i < n; i += 1) {
      gAtt[i] -= params.l2 * totalWeight * attack[i];
      gDef[i] -= params.l2 * totalWeight * defence[i];
    }
    // Average gradients so the step size is independent of sample size.
    const scale = 1 / Math.max(1, totalWeight);

    let improved = false;
    for (let tries = 0; tries < 12; tries += 1) {
      const nAtt = attack.map((v, i) => v + step * scale * gAtt[i]);
      const nDef = defence.map((v, i) => v + step * scale * gDef[i]);
      // Re-centre so the intercept, not the strengths, carries the league mean.
      const mAtt = nAtt.reduce((s, v) => s + v, 0) / n;
      const mDef = nDef.reduce((s, v) => s + v, 0) / n;
      for (let i = 0; i < n; i += 1) {
        nAtt[i] -= mAtt;
        nDef[i] -= mDef;
      }
      const nBase = base + step * scale * gBase + mAtt + mDef;
      const nHome = home + step * scale * gHome;
      const nRho = Math.max(-0.25, Math.min(0.25, rho + step * scale * gRho * 0.1));
      const candidate = logLik(nAtt, nDef, nBase, nHome, nRho);
      if (candidate > current) {
        const gain = candidate - current;
        for (let i = 0; i < n; i += 1) {
          attack[i] = nAtt[i];
          defence[i] = nDef[i];
        }
        base = nBase;
        home = nHome;
        rho = nRho;
        current = candidate;
        improved = true;
        step = Math.min(2, step * 1.2);
        if (gain < 1e-7 * Math.max(1, Math.abs(current))) {
          return finish(teams, attack, defence, base, home, rho, rows.length, current);
        }
        break;
      }
      step *= 0.5;
    }
    if (!improved) break;
  }
  return finish(teams, attack, defence, base, home, rho, rows.length, current);
}

function finish(teams: string[], attack: number[], defence: number[], base: number, home: number, rho: number, matches: number, ll: number): DcState {
  return {
    teams,
    attack: Object.fromEntries(teams.map((t, i) => [t, attack[i]])),
    defence: Object.fromEntries(teams.map((t, i) => [t, defence[i]])),
    base,
    home,
    rho,
    matches,
    logLikelihood: ll,
    fittedAt: new Date().toISOString(),
  };
}

/** Expected goals for a fixture. Unknown teams are treated as league average. */
export function dcRates(state: DcState, home: string, away: string): { lambdaHome: number; lambdaAway: number } {
  const ah = state.attack[home] ?? 0;
  const dh = state.defence[home] ?? 0;
  const aa = state.attack[away] ?? 0;
  const da = state.defence[away] ?? 0;
  return {
    lambdaHome: Math.exp(state.base + ah + da + state.home),
    lambdaAway: Math.exp(state.base + aa + dh),
  };
}

/** Human-readable strengths: goals for/against per game relative to the league. */
export function dcTeamProfile(state: DcState, team: string): { attack: number; defence: number } {
  return { attack: Math.exp(state.attack[team] ?? 0), defence: Math.exp(state.defence[team] ?? 0) };
}
