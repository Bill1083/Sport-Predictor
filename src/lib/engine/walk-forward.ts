/**
 * The walk-forward pass: replay history in weekly chunks, predicting each
 * chunk with models fitted only on what came before. It is both the
 * backtest (report how each model would have done) and the training loop
 * for the feature model and the ensemble temperature, which need honest
 * out-of-sample rows to learn from.
 */

import { fitDixonColes, dcRates, type DcParams, type DcState } from '@/lib/engine/dixon-coles';
import { applyEloMatch, calibrateDrawBase, emptyElo, eloPredict, type EloParams, type EloState } from '@/lib/engine/elo';
import { applyTemperature, blend, clipProbs, fitTemperature, toOrdered, type Member } from '@/lib/engine/ensemble';
import { buildFeatures, FEATURE_KEYS } from '@/lib/engine/features';
import { outcomeFrequencies, outcomeOf, type HistoryMatch } from '@/lib/engine/history';
import { fitLogistic, predictLogistic, type LogisticParams, type LogisticState } from '@/lib/engine/logistic';
import { fitMargin, marginPredict, type MarginState } from '@/lib/engine/margin';
import { calibrationBins, calibrationSlope, score, summarise, type CalibrationBin, type Scores, type Summary } from '@/lib/engine/metrics';
import { gridOutcomes, scoreGrid } from '@/lib/engine/poisson';
import { DEFAULT_RANK_PARAMS, fitRankBeta, rankProbs, type RankSample } from '@/lib/engine/sports/tennis-rank';
import type { ModelSettings } from '@/lib/engine/config';
import { outcomesFor, type SportDefinition } from '@/lib/sports/registry';
import type { ProbMap } from '@/lib/types';

export interface WalkForwardOptions {
  chunkDays: number;
  refitEveryDays: number;
  /** Only score matches on or after this date (models still learn from earlier ones). */
  scoreFrom?: Date;
  /** Retrain the feature model every this many chunks once enough rows exist. */
  mlRetrainChunks: number;
  mlMinRows: number;
  onProgress?: (done: number, total: number) => void;
}

export const DEFAULT_WALK_OPTIONS: WalkForwardOptions = { chunkDays: 7, refitEveryDays: 28, mlRetrainChunks: 8, mlMinRows: 200 };

export interface WalkRow {
  eventId: string;
  competitionId: string;
  date: Date;
  outcome: string;
  features: Record<string, number>;
  probs: Record<string, ProbMap>;
}

export interface WalkReport {
  rows: number;
  scored: number;
  models: Record<string, Summary>;
  byCompetition: Record<string, Record<string, Summary>>;
  calibration: CalibrationBin[];
  calibrationSlope: number | null;
  temperature: number;
  /** Weights that minimised the ensemble log loss on these rows. */
  bestWeights: Record<string, number>;
  bestWeightsLogLoss: number;
  from: string | null;
  to: string | null;
}

export interface WalkResult {
  rows: WalkRow[];
  report: WalkReport;
  finalElo: EloState;
  finalDc: Map<string, DcState>;
  finalMargin: MarginState | null;
  ml: LogisticState | null;
}

interface CompetitionModels {
  dc: DcState | null;
  fittedAt: Date | null;
}

function paramsOf<T>(configs: Map<string, ModelSettings>, key: string, fallback: T): T {
  return { ...fallback, ...((configs.get(key)?.params ?? {}) as Partial<T>) } as T;
}

export async function walkForward(
  history: HistoryMatch[],
  sport: SportDefinition,
  configs: Map<string, ModelSettings>,
  options: WalkForwardOptions = DEFAULT_WALK_OPTIONS,
): Promise<WalkResult> {
  const outcomes: string[] = outcomesFor(sport);
  const hasDraws = sport.hasDraws;
  const isPlayerSport = sport.shape === 'PLAYER_VS_PLAYER';
  const rankParams = { ...DEFAULT_RANK_PARAMS, ...((configs.get('rank')?.params ?? {}) as Partial<typeof DEFAULT_RANK_PARAMS>) };
  let rankBeta = rankParams.beta;
  const usesDc = configs.has('dixon-coles');
  const usesMargin = configs.has('margin');
  const usesRank = configs.has('rank');
  const eloParams = paramsOf<EloParams>(configs, 'elo', emptyElo().params);
  const dcParams = paramsOf<DcParams>(configs, 'dixon-coles', { xi: 0.0018, maxIterations: 300, l2: 0.02, maxAgeDays: 1_200 });
  const mlParams = paramsOf<LogisticParams>(configs, 'ml', { l2: 0.5, iterations: 500, learningRate: 0.15 });
  const weights: Record<string, number> = {};
  for (const [key, settings] of configs) if (settings.enabled && settings.weight > 0 && key !== 'ensemble' && key !== 'ai') weights[key] = settings.weight;

  const sorted = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());
  const drawBase = hasDraws
    ? calibrateDrawBase(
        sorted.map((m) => ({ home: m.home, away: m.away, homeScore: m.homeScore, awayScore: m.awayScore, date: m.date, season: m.season })),
        eloParams,
      )
    : 0;
  const elo = emptyElo({ ...eloParams, drawBase });
  const byCompetition = new Map<string, CompetitionModels>();
  let margin: MarginState | null = null;
  let marginFittedAt: Date | null = null;
  let ml: LogisticState | null = null;
  const rows: WalkRow[] = [];
  const seen: HistoryMatch[] = [];
  const scores = new Map<string, Scores[]>();
  const scoresByCompetition = new Map<string, Map<string, Scores[]>>();
  const calibrationPairs: { p: number; hit: boolean }[] = [];

  if (sorted.length === 0) {
    return { rows, report: emptyReport(), finalElo: elo, finalDc: new Map(), finalMargin: null, ml: null };
  }

  const chunkMs = options.chunkDays * 86_400_000;
  let chunkStart = new Date(Math.floor(sorted[0].date.getTime() / chunkMs) * chunkMs);
  let index = 0;
  let chunkIndex = 0;
  const total = sorted.length;

  while (index < total) {
    const chunkEnd = new Date(chunkStart.getTime() + chunkMs);
    const chunk: HistoryMatch[] = [];
    while (index < total && sorted[index].date < chunkEnd) {
      chunk.push(sorted[index]);
      index += 1;
    }
    if (chunk.length > 0) {
      // Refit score models on what came before this chunk, when stale.
      const competitions = new Set(chunk.map((m) => m.competitionId));
      for (const competitionId of competitions) {
        const models = byCompetition.get(competitionId) ?? { dc: null, fittedAt: null };
        if (usesDc && (!models.fittedAt || chunkStart.getTime() - models.fittedAt.getTime() >= options.refitEveryDays * 86_400_000)) {
          const prior = seen.filter((m) => m.competitionId === competitionId);
          models.dc = prior.length >= 30 ? fitDixonColes(prior.map(toDc), chunkStart, dcParams) : null;
          models.fittedAt = chunkStart;
        }
        byCompetition.set(competitionId, models);
      }
      if (usesMargin && (!marginFittedAt || chunkStart.getTime() - marginFittedAt.getTime() >= options.refitEveryDays * 86_400_000)) {
        margin = seen.length >= 20 ? fitMargin(seen, elo, chunkStart, sport.priors) : null;
        marginFittedAt = chunkStart;
      }
      if (usesRank && chunkIndex % options.mlRetrainChunks === 0) {
        // Only matches already played, so the fitted beta never sees its own future.
        const samples: RankSample[] = [];
        for (const m of seen) {
          const rh = m.stats.home?.rank;
          const ra = m.stats.away?.rank;
          if (typeof rh === 'number' && typeof ra === 'number' && rh > 0 && ra > 0) {
            samples.push({ rankHome: rh, rankAway: ra, homeWon: m.homeScore > m.awayScore });
          }
        }
        rankBeta = fitRankBeta(samples, rankParams).beta;
      }
      if (chunkIndex % options.mlRetrainChunks === 0 && rows.length >= options.mlMinRows) {
        ml = fitLogistic(
          rows.map((r) => ({ features: r.features, outcome: r.outcome })),
          outcomes,
          [...FEATURE_KEYS],
          mlParams,
        );
      }

      // Predict every match in the chunk before any of them updates the ratings.
      const tableless = { home: null, away: null, teams: 0 };
      for (const match of chunk) {
        const models = byCompetition.get(match.competitionId);
        const probs: Record<string, ProbMap> = {};
        const priorMatches = seen.filter((m) => m.competitionId === match.competitionId);
        if (!isPlayerSport) probs.baseline = outcomeFrequencies(priorMatches.slice(-380), hasDraws);
        probs.elo = eloPredict(elo, match.home, match.away, hasDraws);
        let scoreProbs: ProbMap | null = null;
        if (usesDc && models?.dc) {
          const { lambdaHome, lambdaAway } = dcRates(models.dc, match.home, match.away);
          const grid = gridOutcomes(scoreGrid(lambdaHome, lambdaAway, models.dc.rho));
          scoreProbs = hasDraws ? grid : { HOME: grid.HOME / (grid.HOME + grid.AWAY), AWAY: grid.AWAY / (grid.HOME + grid.AWAY) };
          probs['dixon-coles'] = scoreProbs;
        } else if (usesMargin && margin) {
          scoreProbs = marginPredict(margin, elo, match.home, match.away, hasDraws).probs;
          probs.margin = scoreProbs;
        }
        if (usesRank) {
          const rp = rankProbs(match.stats.home?.rank ?? null, match.stats.away?.rank ?? null, { ...rankParams, beta: rankBeta });
          if (rp) probs.rank = rp;
        }
        const features = buildFeatures({ history: seen, home: match.home, away: match.away, kickoff: match.date, elo, dcProbs: scoreProbs, positions: tableless, absences: { home: 0, away: 0 } });
        if (ml) probs.ml = predictLogistic(ml, features);
        const members: Member[] = Object.entries(probs)
          .filter(([key]) => weights[key] !== undefined)
          .map(([key, p]) => ({ key, probs: p, weight: weights[key] }));
        probs.ensemble = clipProbs(blend(members, outcomes));

        const outcome = outcomeOf(match);
        rows.push({ eventId: match.id, competitionId: match.competitionId, date: match.date, outcome, features, probs });
        // An outcome the sport does not have (a level score in a no-draw sport)
        // cannot be scored against, so it is left out rather than charged as a
        // maximum-loss miss to every model at once.
        if ((!options.scoreFrom || match.date >= options.scoreFrom) && outcomes.includes(outcome)) {
          const index = outcomes.indexOf(outcome);
          for (const [key, p] of Object.entries(probs)) {
            const s = score(toOrdered(p, outcomes), index);
            (scores.get(key) ?? scores.set(key, []).get(key)!).push(s);
            const byComp = scoresByCompetition.get(match.competitionId) ?? scoresByCompetition.set(match.competitionId, new Map()).get(match.competitionId)!;
            (byComp.get(key) ?? byComp.set(key, []).get(key)!).push(s);
          }
          for (const o of outcomes) calibrationPairs.push({ p: probs.ensemble[o] ?? 0, hit: o === outcome });
        }
      }
      // Now the chunk becomes history.
      for (const match of chunk) {
        applyEloMatch(elo, { home: match.home, away: match.away, homeScore: match.homeScore, awayScore: match.awayScore, date: match.date, season: match.season });
        seen.push(match);
      }
      chunkIndex += 1;
      options.onProgress?.(index, total);
    }
    chunkStart = chunkEnd;
  }

  // Temperature and best weights from the scored rows.
  const scoredRows = rows.filter((r) => (!options.scoreFrom || r.date >= options.scoreFrom) && outcomes.includes(r.outcome));
  const temperature = fitTemperature(scoredRows.map((r) => ({ probs: toOrdered(r.probs.ensemble, outcomes), index: outcomes.indexOf(r.outcome) })));
  const search = bestWeights(scoredRows, Object.keys(weights), outcomes);

  const models: Record<string, Summary> = {};
  for (const [key, list] of scores) models[key] = summarise(list);
  if (models.ensemble && temperature !== 1) {
    const tempered = scoredRows.map((r) => score(toOrdered(applyTemperature(r.probs.ensemble, temperature), outcomes), outcomes.indexOf(r.outcome)));
    models['ensemble-calibrated'] = summarise(tempered);
  }
  const byCompetitionOut: Record<string, Record<string, Summary>> = {};
  for (const [competitionId, map] of scoresByCompetition) {
    byCompetitionOut[competitionId] = {};
    for (const [key, list] of map) byCompetitionOut[competitionId][key] = summarise(list);
  }
  const bins = calibrationBins(calibrationPairs);
  const finalDc = new Map<string, DcState>();
  for (const [competitionId, m] of byCompetition) if (m.dc) finalDc.set(competitionId, m.dc);

  return {
    rows,
    report: {
      rows: rows.length,
      scored: scoredRows.length,
      models,
      byCompetition: byCompetitionOut,
      calibration: bins,
      calibrationSlope: calibrationSlope(bins),
      temperature,
      bestWeights: search.weights,
      bestWeightsLogLoss: search.logLoss,
      from: scoredRows[0]?.date.toISOString() ?? null,
      to: scoredRows[scoredRows.length - 1]?.date.toISOString() ?? null,
    },
    finalElo: elo,
    finalDc,
    finalMargin: margin,
    ml,
  };
}

function toDc(m: HistoryMatch) {
  return { home: m.home, away: m.away, homeGoals: m.homeScore, awayGoals: m.awayScore, date: m.date };
}

function emptyReport(): WalkReport {
  return { rows: 0, scored: 0, models: {}, byCompetition: {}, calibration: [], calibrationSlope: null, temperature: 1, bestWeights: {}, bestWeightsLogLoss: 0, from: null, to: null };
}

/** Grid search over blend weights (step 0.1) minimising ensemble log loss. */
export function bestWeights(rows: WalkRow[], keys: string[], outcomes: string[]): { weights: Record<string, number>; logLoss: number } {
  const usable = keys.filter((k) => rows.some((r) => r.probs[k]));
  if (usable.length === 0 || rows.length === 0) return { weights: {}, logLoss: 0 };
  let best: { weights: Record<string, number>; logLoss: number } | null = null;
  const steps = 10;
  const combos: number[][] = [];
  const recurse = (prefix: number[], remaining: number) => {
    if (prefix.length === usable.length - 1) {
      combos.push([...prefix, remaining]);
      return;
    }
    for (let i = 0; i <= remaining; i += 1) recurse([...prefix, i], remaining - i);
  };
  recurse([], steps);
  for (const combo of combos) {
    if (combo.every((c) => c === 0)) continue;
    const weights = Object.fromEntries(usable.map((k, i) => [k, combo[i] / steps]));
    let total = 0;
    let n = 0;
    for (const row of rows) {
      const members: Member[] = usable.filter((k) => row.probs[k]).map((k) => ({ key: k, probs: row.probs[k], weight: weights[k] }));
      if (members.every((m) => m.weight === 0)) continue;
      const p = clipProbs(blend(members, outcomes));
      total -= Math.log(Math.max(1e-9, p[row.outcome] ?? 0));
      n += 1;
    }
    const ll = n > 0 ? total / n : Number.POSITIVE_INFINITY;
    if (!best || ll < best.logLoss) best = { weights, logLoss: ll };
  }
  return best ?? { weights: {}, logLoss: 0 };
}
