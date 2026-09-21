/**
 * Engine jobs: predict, evaluate, refit, backtest.
 */

import { loadModelConfigs, saveModelState, updateModelConfig, type ModelSettings } from '@/lib/engine/config';
import { evaluateFinished } from '@/lib/engine/evaluate';
import { loadSportHistory } from '@/lib/engine/history';
import { predictSport } from '@/lib/engine/predict';
import { walkForward, DEFAULT_WALK_OPTIONS } from '@/lib/engine/walk-forward';
import { registerJob } from '@/lib/jobs/registry';
import type { JobHandler, JobScope } from '@/lib/jobs/types';
import { prisma, withDatabase } from '@/lib/prisma';
import { isSportKey, sportDefinition, type SportKey } from '@/lib/sports/registry';

async function sportsIn(scope: JobScope): Promise<SportKey[]> {
  if (scope.sportKey) return isSportKey(scope.sportKey) ? [scope.sportKey] : [];
  const rows = await prisma.sport.findMany({ where: { enabled: true } });
  return rows.map((r) => r.key).filter(isSportKey);
}

const predict: JobHandler = {
  kind: 'PREDICT',
  label: 'Predict upcoming',
  defaultIntervalMinutes: 60,
  perSport: true,
  async run(scope, progress) {
    const sports = await sportsIn(scope);
    let predicted = 0;
    let considered = 0;
    for (const sportKey of sports) {
      await progress.phase(`predicting ${sportKey}`);
      const summary = await predictSport(sportKey, {
        eventIds: Array.isArray(scope.options?.eventIds) ? (scope.options?.eventIds as string[]) : undefined,
        force: scope.options?.force === true,
        log: (line) => progress.log(line),
        runId: progress.runId,
        onCost: (usd) => progress.cost(usd),
        onProgress: async (done, total) => {
          if (done === 1) await progress.phase(`predicting ${sportKey}`, total);
          await progress.tick();
        },
      });
      predicted += summary.predicted;
      considered += summary.considered;
      progress.log(`${sportKey}: ${summary.predicted} predicted, ${summary.skipped} up to date`);
    }
    return { status: 'OK', message: `${predicted} event${predicted === 1 ? '' : 's'} predicted (${considered} upcoming)`, metrics: { predicted, considered } };
  },
};

const evaluate: JobHandler = {
  kind: 'EVALUATE',
  label: 'Score finished events',
  defaultIntervalMinutes: 30,
  perSport: true,
  async run(scope, progress) {
    const sports = await sportsIn(scope);
    let events = 0;
    let evaluations = 0;
    for (const sportKey of sports) {
      await progress.phase(`scoring ${sportKey}`);
      const summary = await evaluateFinished(sportKey);
      events += summary.events;
      evaluations += summary.evaluations;
    }
    return { status: 'OK', message: `${evaluations} predictions scored across ${events} events`, metrics: { events, evaluations } };
  },
};

async function walk(sportKey: SportKey, scope: JobScope, progress: Parameters<JobHandler['run']>[1]) {
  const sport = sportDefinition(sportKey);
  if (!sport) return null;
  const configs = await loadModelConfigs(sportKey);
  const settings = new Map<string, ModelSettings>();
  for (const [key, loaded] of configs) settings.set(key, loaded.settings);
  const history = await loadSportHistory(sportKey, new Date(), scope.competitionId ?? undefined);
  if (history.length < 50) {
    progress.log(`${sportKey}: only ${history.length} finished matches; need at least 50`);
    return null;
  }
  const seasonsBack = typeof scope.options?.scoreSeasons === 'number' ? (scope.options.scoreSeasons as number) : null;
  const seasons = Array.from(new Set(history.map((m) => m.season))).sort();
  const scoreFrom = seasonsBack && seasons.length > seasonsBack ? history.find((m) => m.season === seasons[seasons.length - seasonsBack])?.date : undefined;
  await progress.phase(`walk-forward ${sportKey}`, history.length);
  let lastDone = 0;
  const result = await walkForward(history, sport, settings, {
    ...DEFAULT_WALK_OPTIONS,
    scoreFrom,
    onProgress: (done) => {
      const step = done - lastDone;
      lastDone = done;
      void progress.tick(step);
    },
  });
  return { sport, configs, result, history };
}

const refit: JobHandler = {
  kind: 'REFIT',
  label: 'Refit models',
  defaultIntervalMinutes: 7 * 24 * 60,
  perSport: true,
  async run(scope, progress) {
    const sports = await sportsIn(scope);
    const notes: string[] = [];
    for (const sportKey of sports) {
      const walked = await walk(sportKey, scope, progress);
      if (!walked) continue;
      const { result, history } = walked;
      await progress.phase(`saving ${sportKey}`);
      // Ratings: one row per team per match, for the trend charts.
      await withDatabase(() => prisma.rating.deleteMany({ where: { sportKey, model: 'ELO' } }));
      const points = result.finalElo.history.map((h) => ({ sportKey, teamId: h.team, model: 'ELO', value: Math.round(h.value * 10) / 10, asOf: h.date }));
      for (let i = 0; i < points.length; i += 500) {
        await withDatabase(() => prisma.rating.createMany({ data: points.slice(i, i + 500) }));
      }
      // `games` matters: a rank-seeded competitor blends toward their fitted
      // rating by how much they have played, so dropping it loses that weight.
      await saveModelState(sportKey, '', 'elo', { ratings: result.finalElo.ratings, lastSeason: result.finalElo.lastSeason, games: result.finalElo.games }, { drawBase: result.finalElo.params.drawBase });
      for (const [competitionId, state] of result.finalDc) await saveModelState(sportKey, competitionId, 'dixon-coles', state);
      if (result.ml) await saveModelState(sportKey, '', 'ml', result.ml);
      await updateModelConfig(sportKey, 'ensemble', { params: { temperature: Math.round(result.report.temperature * 1000) / 1000 } });
      if (scope.options?.applyWeights !== false && Object.keys(result.report.bestWeights).length > 0) {
        for (const [key, weight] of Object.entries(result.report.bestWeights)) await updateModelConfig(sportKey, key, { weight });
      }
      const ens = result.report.models.ensemble;
      notes.push(`${sportKey}: ${history.length} matches, ensemble log loss ${ens ? ens.logLoss.toFixed(3) : 'n/a'}, temperature ${result.report.temperature.toFixed(2)}, ml ${result.ml ? 'trained' : 'skipped'}`);
      progress.log(notes[notes.length - 1]);
    }
    return { status: 'OK', message: notes.join('; ') || 'nothing to refit', metrics: { sports: sports.length } };
  },
};

const backtest: JobHandler = {
  kind: 'BACKTEST',
  label: 'Backtest',
  defaultIntervalMinutes: null,
  perSport: true,
  async run(scope, progress) {
    const sports = await sportsIn(scope);
    const reports: Record<string, unknown> = {};
    const notes: string[] = [];
    for (const sportKey of sports) {
      const walked = await walk(sportKey, { ...scope, options: { scoreSeasons: 2, ...(scope.options ?? {}) } }, progress);
      if (!walked) continue;
      const { report } = walked.result;
      reports[sportKey] = report;
      const ens = report.models.ensemble;
      const base = report.models.baseline;
      notes.push(
        `${sportKey}: ${report.scored} scored; ensemble log loss ${ens?.logLoss.toFixed(3)}${ens?.rps !== null && ens?.rps !== undefined ? `, RPS ${ens.rps.toFixed(3)}` : ''}, accuracy ${Math.round((ens?.accuracy ?? 0) * 100)}% vs baseline ${base?.logLoss.toFixed(3)}`,
      );
      progress.log(notes[notes.length - 1]);
    }
    return { status: 'OK', message: notes.join('; ') || 'nothing to backtest', metrics: reports };
  },
};

registerJob('predict', predict);
registerJob('evaluate', evaluate);
registerJob('refit', refit);
registerJob('backtest', backtest);
