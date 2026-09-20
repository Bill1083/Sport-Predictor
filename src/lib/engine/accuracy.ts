/**
 * Aggregations behind the Accuracy page: per-model summaries, per-competition
 * summaries for the ensemble, a weekly log-loss timeline and the reliability
 * bins, all from stored Evaluation rows.
 */

import { toOrdered } from '@/lib/engine/ensemble';
import { calibrationBins, calibrationSlope, summarise, type CalibrationBin, type Scores, type Summary } from '@/lib/engine/metrics';
import { parseJson, prisma, withDatabase } from '@/lib/prisma';
import { outcomesFor, sportDefinition } from '@/lib/sports/registry';
import { dayKey } from '@/lib/time';
import { parseResult, resultWinner, type ProbMap } from '@/lib/types';

export interface AccuracyReport {
  total: number;
  since: string | null;
  models: Record<string, Summary & { exactScoreRate: number | null }>;
  byCompetition: { competitionId: string; name: string; summary: Summary }[];
  timeline: { week: string; [model: string]: number | string | null }[];
  timelineModels: string[];
  calibration: CalibrationBin[];
  calibrationSlope: number | null;
  statCoverage: { key: string; n: number; withinRange: number; meanAbsError: number }[];
  upsets: { eventId: string; label: string; date: string; favourite: number; outcome: string }[];
  /** Your own picks on finished events against the ensemble favourite on the same events. */
  picks: { n: number; correct: number; modelCorrect: number };
}

export async function accuracyReport(sportKey: string | null, days = 365, limit = 4000): Promise<AccuracyReport> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await withDatabase(() =>
    prisma.evaluation.findMany({
      where: { createdAt: { gte: since }, ...(sportKey ? { event: { sportKey } } : {}) },
      include: {
        prediction: { select: { probsJson: true, scoreJson: true } },
        event: { select: { id: true, sportKey: true, startsAt: true, resultJson: true, competitionId: true, competition: { select: { name: true } }, homeTeam: { select: { name: true } }, awayTeam: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  );
  const list = rows.ok ? rows.data : [];
  const scoresByModel = new Map<string, Scores[]>();
  const exactByModel = new Map<string, { n: number; hits: number }>();
  const byCompetition = new Map<string, { name: string; scores: Scores[] }>();
  const weekly = new Map<string, Map<string, number[]>>();
  const pairs: { p: number; hit: boolean }[] = [];
  const statAcc = new Map<string, { n: number; within: number; abs: number }>();
  const upsets: AccuracyReport['upsets'] = [];

  for (const row of list) {
    const s: Scores = { brier: row.brier, logLoss: row.logLoss, rps: row.rps, correct: row.correct };
    (scoresByModel.get(row.modelKey) ?? scoresByModel.set(row.modelKey, []).get(row.modelKey)!).push(s);
    if (row.exactScore !== null) {
      const e = exactByModel.get(row.modelKey) ?? { n: 0, hits: 0 };
      e.n += 1;
      e.hits += row.exactScore ? 1 : 0;
      exactByModel.set(row.modelKey, e);
    }
    const weekStart = new Date(row.event.startsAt);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    const week = dayKey(weekStart, 'UTC');
    const bucket = weekly.get(week) ?? weekly.set(week, new Map()).get(week)!;
    (bucket.get(row.modelKey) ?? bucket.set(row.modelKey, []).get(row.modelKey)!).push(row.logLoss);

    if (row.modelKey === 'ensemble') {
      const comp = byCompetition.get(row.event.competitionId) ?? byCompetition.set(row.event.competitionId, { name: row.event.competition.name, scores: [] }).get(row.event.competitionId)!;
      comp.scores.push(s);
      const sport = sportDefinition(row.event.sportKey);
      const winner = resultWinner(parseResult(row.event.resultJson));
      if (sport && winner) {
        const outcomes = outcomesFor(sport);
        const probs = parseJson<ProbMap>(row.prediction.probsJson, {});
        const ordered = toOrdered(probs, outcomes);
        outcomes.forEach((o, i) => pairs.push({ p: ordered[i], hit: o === winner }));
        const favourite = Math.max(...ordered);
        const winnerP = probs[winner] ?? 0;
        if (favourite >= 0.55 && winnerP <= 0.2) {
          upsets.push({
            eventId: row.event.id,
            label: `${row.event.homeTeam?.name ?? '?'} v ${row.event.awayTeam?.name ?? '?'}`,
            date: row.event.startsAt.toISOString(),
            favourite: Math.round(favourite * 100),
            outcome: winner,
          });
        }
      }
      const statsError = parseJson<Record<string, { home: number; away: number; withinRange: boolean }> | null>(row.statsErrorJson, null);
      if (statsError) {
        for (const [key, err] of Object.entries(statsError)) {
          const a = statAcc.get(key) ?? { n: 0, within: 0, abs: 0 };
          a.n += 1;
          a.within += err.withinRange ? 1 : 0;
          a.abs += (Math.abs(err.home) + Math.abs(err.away)) / 2;
          statAcc.set(key, a);
        }
      }
    }
  }

  const models: AccuracyReport['models'] = {};
  for (const [key, scores] of scoresByModel) {
    const exact = exactByModel.get(key);
    models[key] = { ...summarise(scores), exactScoreRate: exact && exact.n > 0 ? exact.hits / exact.n : null };
  }
  const timelineModels = Array.from(scoresByModel.keys()).filter((k) => k !== 'stats');
  const timeline = Array.from(weekly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, bucket]) => {
      const point: { week: string; [model: string]: number | string | null } = { week: week.slice(5) };
      for (const model of timelineModels) {
        const values = bucket.get(model);
        point[model] = values && values.length > 0 ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 1000) / 1000 : null;
      }
      return point;
    });
  const bins = calibrationBins(pairs);
  const pickRows = await withDatabase(() =>
    prisma.userPick.findMany({
      where: { event: { status: 'FINISHED', ...(sportKey ? { sportKey } : {}), startsAt: { gte: since } } },
      include: { event: { select: { resultJson: true, sportKey: true, predictions: { where: { modelKey: 'ensemble', isFinal: true }, take: 1, select: { probsJson: true } } } } },
    }),
  );
  const picks = { n: 0, correct: 0, modelCorrect: 0 };
  for (const row of pickRows.ok ? pickRows.data : []) {
    const winner = resultWinner(parseResult(row.event.resultJson));
    if (!winner) continue;
    picks.n += 1;
    if (row.outcome === winner) picks.correct += 1;
    const final = row.event.predictions[0];
    if (final) {
      const probs = parseJson<ProbMap>(final.probsJson, {});
      const favourite = Object.entries(probs).sort((x, y) => y[1] - x[1])[0]?.[0];
      if (favourite === winner) picks.modelCorrect += 1;
    }
  }
  return {
    picks,
    total: list.filter((r) => r.modelKey === 'ensemble').length,
    since: list.length > 0 ? list[list.length - 1].createdAt.toISOString() : null,
    models,
    byCompetition: Array.from(byCompetition.entries()).map(([competitionId, c]) => ({ competitionId, name: c.name, summary: summarise(c.scores) })),
    timeline,
    timelineModels,
    calibration: bins,
    calibrationSlope: calibrationSlope(bins),
    statCoverage: Array.from(statAcc.entries()).map(([key, a]) => ({ key, n: a.n, withinRange: a.n > 0 ? a.within / a.n : 0, meanAbsError: a.n > 0 ? a.abs / a.n : 0 })),
    upsets: upsets.sort((a, b) => b.favourite - a.favourite).slice(0, 8),
  };
}
