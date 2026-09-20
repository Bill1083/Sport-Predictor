/**
 * Making predictions for upcoming events and storing them as versioned rows.
 *
 * A pass loads the sport's history once, fits (or loads) the models, then
 * for each target event produces one row per model plus the ensemble row,
 * which also carries the score forecast, the stat forecasts and the
 * explanatory factors. Versions grow as kickoff approaches: 48h out, 24h
 * out, and once lineups are known.
 */

import type { Event } from '@prisma/client';

import { assessEvent } from '@/lib/ai/assess';
import { loadModelConfigs, saveModelState, type LoadedModel } from '@/lib/engine/config';
import { fitDixonColes, dcRates, type DcParams, type DcState } from '@/lib/engine/dixon-coles';
import { computeElo, eloPredict, eloRating, type EloParams, type EloState } from '@/lib/engine/elo';
import { applyTemperature, blend, clipProbs, type Member } from '@/lib/engine/ensemble';
import { buildFeatures, contributionsToFactors, heuristicFactors } from '@/lib/engine/features';
import { loadSportHistory, outcomeFrequencies, type HistoryMatch } from '@/lib/engine/history';
import { logisticContributions, predictLogistic, type LogisticState } from '@/lib/engine/logistic';
import { fitMargin, marginPredict, type MarginState } from '@/lib/engine/margin';
import { gridOutcomes, scoreForecastFromGrid, scoreGrid } from '@/lib/engine/poisson';
import { fitStats, forecastStats, type StatParams, type StatSample, type StatState } from '@/lib/engine/stats-model';
import type { EnsembleParams } from '@/lib/engine/config';
import { parseJson, prisma, withDatabase } from '@/lib/prisma';
import { getGlobalSettings, getSportSettings } from '@/lib/settings';
import { outcomesFor, sportDefinition, type SportDefinition, type SportKey } from '@/lib/sports/registry';
import { buildTable } from '@/lib/standings';
import type { Factor, ProbMap, ScoreForecast, StatForecasts } from '@/lib/types';

export interface PredictOptions {
  /** Restrict to these events; otherwise every upcoming event within the horizon. */
  eventIds?: string[];
  horizonDays?: number;
  /** Force a new version even if the current stage already has one. */
  force?: boolean;
  onProgress?: (done: number, total: number) => Promise<void> | void;
  log?: (line: string) => void;
  runId?: string | null;
  /** Called with the USD cost of each AI call made during the pass. */
  onCost?: (usd: number) => void;
}

export interface PredictSummary {
  considered: number;
  predicted: number;
  skipped: number;
}

/** Everything fitted once per pass and reused for every event. */
export interface SportModels {
  sport: SportDefinition;
  configs: Map<string, LoadedModel>;
  history: HistoryMatch[];
  elo: EloState;
  dc: Map<string, DcState>;
  stats: Map<string, StatState>;
  margin: MarginState | null;
  ml: LogisticState | null;
  ensemble: EnsembleParams;
  weights: Record<string, number>;
}

function paramsOf<T>(configs: Map<string, LoadedModel>, key: string, fallback: T): T {
  return { ...fallback, ...((configs.get(key)?.settings.params ?? {}) as Partial<T>) } as T;
}

/** Load stored states where fresh enough, otherwise fit from history now. */
export async function prepareSportModels(sportKey: SportKey, log?: (line: string) => void): Promise<SportModels | null> {
  const sport = sportDefinition(sportKey);
  if (!sport) return null;
  const configs = await loadModelConfigs(sportKey);
  const history = await loadSportHistory(sportKey, new Date());
  const now = new Date();

  const eloParams = paramsOf<EloParams>(configs, 'elo', computeElo([]).params);
  const eloStored = configs.get('elo')?.state ? parseJson<{ ratings: Record<string, number>; lastSeason: Record<string, string> } | null>(configs.get('elo')!.state, null) : null;
  let elo: EloState;
  if (eloStored && configs.get('elo')?.fittedAt && now.getTime() - (configs.get('elo')!.fittedAt as Date).getTime() < 6 * 3_600_000) {
    elo = { ratings: eloStored.ratings, lastSeason: eloStored.lastSeason, games: {}, history: [], params: eloParams, updatedThrough: null };
  } else {
    elo = computeElo(
      history.map((m) => ({ home: m.home, away: m.away, homeScore: m.homeScore, awayScore: m.awayScore, date: m.date, season: m.season })),
      eloParams,
    );
    await saveModelState(sportKey, '', 'elo', { ratings: elo.ratings, lastSeason: elo.lastSeason });
    log?.(`elo fitted on ${history.length} matches`);
  }

  const dc = new Map<string, DcState>();
  const stats = new Map<string, StatState>();
  const competitions = Array.from(new Set(history.map((m) => m.competitionId)));
  const usesDc = configs.has('dixon-coles');
  const dcParams = paramsOf<DcParams>(configs, 'dixon-coles', { xi: 0.0018, maxIterations: 400, l2: 0.02, maxAgeDays: 1_200 });
  const statParams = paramsOf<StatParams>(configs, 'stats', { xi: 0.003, shrink: 4, maxAgeDays: 730 });
  const statKeys = sport.stats.map((s) => s.key);
  for (const competitionId of competitions) {
    const own = history.filter((m) => m.competitionId === competitionId);
    const scoped = await loadModelConfigs(sportKey, competitionId);
    const fresh = (key: string) => {
      const row = scoped.get(key);
      return row?.competitionSpecific && row.state && row.fittedAt && now.getTime() - row.fittedAt.getTime() < 24 * 3_600_000 ? row.state : null;
    };
    if (usesDc) {
      const stored = fresh('dixon-coles');
      const state = stored ? parseJson<DcState | null>(stored, null) : null;
      if (state) dc.set(competitionId, state);
      else if (own.length >= 30) {
        const fitted = fitDixonColes(own.map((m) => ({ home: m.home, away: m.away, homeGoals: m.homeScore, awayGoals: m.awayScore, date: m.date })), now, dcParams);
        dc.set(competitionId, fitted);
        await saveModelState(sportKey, competitionId, 'dixon-coles', fitted);
        log?.(`dixon-coles fitted for ${competitionId} on ${own.length} matches (home ${fitted.home.toFixed(2)}, rho ${fitted.rho.toFixed(3)})`);
      }
    }
    const storedStats = fresh('stats');
    const statState = storedStats ? parseJson<StatState | null>(storedStats, null) : null;
    if (statState) stats.set(competitionId, statState);
    else {
      const samples: StatSample[] = [];
      for (const m of own) {
        if (m.stats.home) samples.push({ team: m.home, opponent: m.away, home: true, date: m.date, stats: { ...m.stats.home, goals: m.homeScore } });
        if (m.stats.away) samples.push({ team: m.away, opponent: m.home, home: false, date: m.date, stats: { ...m.stats.away, goals: m.awayScore } });
        if (!m.stats.home && !m.stats.away) {
          samples.push({ team: m.home, opponent: m.away, home: true, date: m.date, stats: { goals: m.homeScore } });
          samples.push({ team: m.away, opponent: m.home, home: false, date: m.date, stats: { goals: m.awayScore } });
        }
      }
      if (samples.length >= 20) {
        const fitted = fitStats(samples, statKeys, now, statParams);
        stats.set(competitionId, fitted);
        await saveModelState(sportKey, competitionId, 'stats', fitted);
      }
    }
  }

  let margin: MarginState | null = null;
  if (!usesDc && history.length >= 20) margin = fitMargin(history, elo, now, sport.priors);

  const mlStored = configs.get('ml')?.state;
  const ml = mlStored ? parseJson<LogisticState | null>(mlStored, null) : null;

  const ensemble = paramsOf<EnsembleParams>(configs, 'ensemble', { temperature: 1, clipFloor: 0.02, clipCeil: 0.96 });
  const weights: Record<string, number> = {};
  for (const [key, loaded] of configs) {
    if (!loaded.settings.enabled || loaded.settings.weight <= 0 || key === 'ensemble' || key === 'baseline' || key === 'stats') continue;
    if (key === 'ml' && !ml) continue;
    if (key === 'ai') continue; // blended separately by the AI layer
    weights[key] = loaded.settings.weight;
  }
  return { sport, configs, history, elo, dc, stats, margin, ml, ensemble, weights };
}

export interface ModelOutputs {
  probs: Record<string, ProbMap>;
  score: ScoreForecast | null;
  stats: StatForecasts | null;
  factors: Factor[];
  features: Record<string, number>;
  ensemble: ProbMap;
  confidence: number;
  narrative?: string | null;
}

type EventForPrediction = Event & { competition: { id: string; currentSeason: string | null } };

/** Run every model for one event using prepared sport models. */
export async function computeOutputs(models: SportModels, event: EventForPrediction): Promise<ModelOutputs | null> {
  if (!event.homeTeamId || !event.awayTeamId) return null;
  const { sport, elo, history } = models;
  const outcomes = outcomesFor(sport);
  const hasDraws = sport.hasDraws;
  const home = event.homeTeamId;
  const away = event.awayTeamId;
  const kickoff = event.startsAt;
  const competitionHistory = history.filter((m) => m.competitionId === event.competitionId && m.date < kickoff);

  const probs: Record<string, ProbMap> = {};
  probs.baseline = outcomeFrequencies(competitionHistory.slice(-380), hasDraws);
  probs.elo = eloPredict(elo, home, away, hasDraws);

  let scoreProbs: ProbMap | null = null;
  let score: ScoreForecast | null = null;
  const dcState = models.dc.get(event.competitionId);
  if (dcState) {
    const { lambdaHome, lambdaAway } = dcRates(dcState, home, away);
    const grid = scoreGrid(lambdaHome, lambdaAway, dcState.rho);
    const raw = gridOutcomes(grid);
    scoreProbs = hasDraws ? raw : { HOME: raw.HOME / (raw.HOME + raw.AWAY), AWAY: raw.AWAY / (raw.HOME + raw.AWAY) };
    probs['dixon-coles'] = scoreProbs;
    score = scoreForecastFromGrid(grid, lambdaHome, lambdaAway);
  } else if (models.margin) {
    const m = marginPredict(models.margin, elo, home, away, hasDraws);
    scoreProbs = m.probs;
    probs.margin = m.probs;
    score = m.score;
  }

  // Table positions and absences as of now.
  const tableRows = await withDatabase(() =>
    prisma.event.findMany({
      where: { competitionId: event.competitionId, season: event.season, startsAt: { lt: kickoff } },
      include: {
        homeTeam: { select: { id: true, name: true, shortName: true, code: true, crestUrl: true } },
        awayTeam: { select: { id: true, name: true, shortName: true, code: true, crestUrl: true } },
      },
    }),
  );
  const table = tableRows.ok ? buildTable(tableRows.data) : [];
  const position = (team: string) => table.find((r) => r.teamId === team)?.position ?? null;
  const absences = await withDatabase(() =>
    prisma.injury.groupBy({ by: ['teamId'], where: { teamId: { in: [home, away] }, resolvedAt: null, status: { in: ['OUT', 'SUSPENDED'] } }, _count: { _all: true } }),
  );
  const outCount = (team: string) => (absences.ok ? absences.data.find((r) => r.teamId === team)?._count._all ?? 0 : 0);

  const features = buildFeatures({
    history,
    home,
    away,
    kickoff,
    elo,
    dcProbs: scoreProbs,
    positions: { home: position(home), away: position(away), teams: table.length },
    absences: { home: outCount(home), away: outCount(away) },
  });
  if (models.ml) probs.ml = predictLogistic(models.ml, features);

  // Market implied probabilities, when the odds benchmark is on and a snapshot exists.
  const snapshot = await withDatabase(() =>
    prisma.oddsSnapshot.findFirst({ where: { eventId: event.id, takenAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }, orderBy: { takenAt: 'desc' } }),
  );
  if (snapshot.ok && snapshot.data) {
    const implied = parseJson<ProbMap>(snapshot.data.impliedJson, {});
    if (outcomes.every((o) => typeof implied[o] === 'number')) probs.market = implied;
  }

  const members: Member[] = Object.entries(probs)
    .filter(([key]) => models.weights[key] !== undefined)
    .map(([key, p]) => ({ key, probs: p, weight: models.weights[key] }));
  let ensemble = blend(members, outcomes);
  ensemble = applyTemperature(ensemble, models.ensemble.temperature);
  ensemble = clipProbs(ensemble, models.ensemble.clipFloor, models.ensemble.clipCeil);

  const factors = models.ml
    ? contributionsToFactors(logisticContributions(models.ml, features), ensemble.HOME ?? 0.5)
    : heuristicFactors(features, elo.params.homeAdvantage);

  const statState = models.stats.get(event.competitionId);
  const stats = statState ? forecastStats(statState, home, away, sport.stats) : null;
  if (stats && score) {
    // The score model owns expected goals; keep the stat table consistent with it.
    const goalsDef = sport.stats.find((s) => s.key === 'goals' || s.key === 'points' || s.key === 'runs');
    if (goalsDef && stats[goalsDef.key]) {
      stats[goalsDef.key].home.mean = score.expected.home;
      stats[goalsDef.key].away.mean = score.expected.away;
    }
  }

  // Confidence: how far the ensemble is from uniform, 0..1.
  const maxP = Math.max(...outcomes.map((o) => ensemble[o] ?? 0));
  const confidence = Math.round(((maxP - 1 / outcomes.length) / (1 - 1 / outcomes.length)) * 100) / 100;

  return { probs, score, stats, factors, features, ensemble, confidence };
}

/** Which refresh stage an event is in: 0 early, 1 within a day, 2 within the lineup window. */
export function stageFor(kickoff: Date, now: Date, lineupMinutes: number): { stage: number; threshold: number } {
  const minutes = (kickoff.getTime() - now.getTime()) / 60_000;
  if (minutes <= lineupMinutes) return { stage: 2, threshold: lineupMinutes };
  if (minutes <= 24 * 60) return { stage: 1, threshold: 24 * 60 };
  return { stage: 0, threshold: Number.POSITIVE_INFINITY };
}

/** Store a prediction pass for an event: one row per model and the ensemble. */
export async function storePrediction(event: Event, outputs: ModelOutputs, mode: string, now = new Date()): Promise<number> {
  const latest = await withDatabase(() => prisma.prediction.findFirst({ where: { eventId: event.id }, orderBy: { version: 'desc' }, select: { version: true } }));
  const version = (latest.ok && latest.data ? latest.data.version : 0) + 1;
  const minutesToKickoff = Math.round((event.startsAt.getTime() - now.getTime()) / 60_000);
  const rows = Object.entries(outputs.probs).map(([modelKey, probs]) => ({
    eventId: event.id,
    modelKey,
    version,
    mode,
    minutesToKickoff,
    probsJson: JSON.stringify(probs),
    scoreJson: modelKey === 'dixon-coles' || modelKey === 'margin' ? JSON.stringify(outputs.score) : null,
  }));
  rows.push({
    eventId: event.id,
    modelKey: 'ensemble',
    version,
    mode,
    minutesToKickoff,
    probsJson: JSON.stringify(outputs.ensemble),
    scoreJson: outputs.score ? JSON.stringify(outputs.score) : null,
  });
  await prisma.$transaction([
    prisma.prediction.createMany({ data: rows }),
    prisma.prediction.updateMany({
      where: { eventId: event.id, modelKey: 'ensemble', version },
      data: {
        statsJson: outputs.stats ? JSON.stringify(outputs.stats) : null,
        factorsJson: JSON.stringify(outputs.factors),
        confidence: outputs.confidence,
        narrative: outputs.narrative ?? null,
      },
    }),
  ]);
  return version;
}

/** Predict every upcoming event of a sport that is due a (new) version. */
export async function predictSport(sportKey: SportKey, options: PredictOptions = {}): Promise<PredictSummary> {
  const [global, sportSettings] = await Promise.all([getGlobalSettings(), getSportSettings(sportKey)]);
  const horizonDays = options.horizonDays ?? global.predictHorizonDays;
  const now = new Date();
  const candidates = await withDatabase(() =>
    prisma.event.findMany({
      where: options.eventIds
        ? { id: { in: options.eventIds } }
        : { sportKey, status: 'SCHEDULED', startsAt: { gte: new Date(now.getTime() - 60 * 60_000), lte: new Date(now.getTime() + horizonDays * 86_400_000) }, competition: { followed: true } },
      include: {
        competition: { select: { id: true, name: true, currentSeason: true } },
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } },
        predictions: { where: { modelKey: 'ensemble' }, orderBy: { version: 'desc' }, take: 1 },
      },
      orderBy: { startsAt: 'asc' },
    }),
  );
  if (!candidates.ok) return { considered: 0, predicted: 0, skipped: 0 };

  const due = candidates.data.filter((event) => {
    if (options.force) return true;
    const last = event.predictions[0];
    if (!last) return true;
    const { stage, threshold } = stageFor(event.startsAt, now, sportSettings.lineupMinutesBefore);
    if (stage === 0) return false;
    return (last.minutesToKickoff ?? Number.POSITIVE_INFINITY) > threshold;
  });
  const summary: PredictSummary = { considered: candidates.data.length, predicted: 0, skipped: candidates.data.length - due.length };
  if (due.length === 0) return summary;

  const models = await prepareSportModels(sportKey, options.log);
  if (!models) return summary;
  options.log?.(`models ready: elo ${Object.keys(models.elo.ratings).length} teams, dc ${models.dc.size} competitions, ml ${models.ml ? 'trained' : 'not trained'}`);
  let done = 0;
  for (const event of due) {
    const outputs = await computeOutputs(models, event);
    if (outputs) {
      if (sportSettings.mode !== 'ALGORITHM') {
        const assessment = await assessEvent({ event, outputs, models, mode: sportSettings.mode, settings: global, runId: options.runId, log: options.log });
        if (assessment) {
          options.onCost?.(assessment.costUsd);
          if (Object.keys(assessment.aiProbs).length > 0) outputs.probs.ai = assessment.aiProbs;
          outputs.ensemble = assessment.probs;
          outputs.factors = [...outputs.factors, ...assessment.factors];
          outputs.narrative = assessment.narrative;
          if (assessment.expectedScore && outputs.score) {
            outputs.score = { ...outputs.score, mostLikely: { ...assessment.expectedScore, p: outputs.score.mostLikely.p } };
          }
          const outcomes = outcomesFor(models.sport);
          const maxP = Math.max(...outcomes.map((o) => outputs.ensemble[o] ?? 0));
          outputs.confidence = Math.round(((maxP - 1 / outcomes.length) / (1 - 1 / outcomes.length)) * 100) / 100;
        }
      }
      await storePrediction(event, outputs, sportSettings.mode, now);
      summary.predicted += 1;
    }
    done += 1;
    await options.onProgress?.(done, due.length);
  }
  return summary;
}
