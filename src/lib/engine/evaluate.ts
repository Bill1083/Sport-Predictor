/**
 * Scoring predictions against results. For each finished event and each
 * model, the last version made before kickoff is the final one; it gets an
 * Evaluation row with Brier, log loss, RPS and whether the favourite won.
 * The ensemble row also records how far each stat forecast was off.
 */

import { toOrdered } from '@/lib/engine/ensemble';
import { score } from '@/lib/engine/metrics';
import { parseJson, prisma, withDatabase } from '@/lib/prisma';
import { outcomesFor, sportDefinition } from '@/lib/sports/registry';
import { parseResult, resultWinner, type ProbMap, type StatForecasts } from '@/lib/types';

export interface EvaluateSummary {
  events: number;
  evaluations: number;
}

export async function evaluateFinished(sportKey?: string, limit = 500): Promise<EvaluateSummary> {
  const events = await withDatabase(() =>
    prisma.event.findMany({
      where: {
        ...(sportKey ? { sportKey } : {}),
        status: 'FINISHED',
        predictions: { some: { evaluation: null } },
      },
      include: { predictions: { include: { evaluation: { select: { id: true } } } }, stats: true },
      orderBy: { startsAt: 'desc' },
      take: limit,
    }),
  );
  if (!events.ok) return { events: 0, evaluations: 0 };
  let evaluations = 0;
  let touched = 0;
  for (const event of events.data) {
    const sport = sportDefinition(event.sportKey);
    if (!sport) continue;
    const result = parseResult(event.resultJson);
    const race = sport.shape === 'MULTI_ENTRANT';
    const raceWinner = race ? (result.extra as { winnerTeamId?: string } | undefined)?.winnerTeamId ?? null : null;
    const winner = race ? raceWinner : resultWinner(result);
    if (!winner) continue;
    touched += 1;

    const byModel = new Map<string, typeof event.predictions>();
    for (const p of event.predictions) (byModel.get(p.modelKey) ?? byModel.set(p.modelKey, []).get(p.modelKey)!).push(p);
    for (const [modelKey, list] of byModel) {
      if (list.some((p) => p.evaluation)) continue;
      const before = list.filter((p) => p.createdAt <= event.startsAt).sort((a, b) => b.version - a.version);
      const final = before[0] ?? list.sort((a, b) => b.version - a.version)[0];
      if (!final) continue;
      const probs = parseJson<ProbMap>(final.probsJson, {});
      const outcomes: string[] = race ? Object.keys(probs) : outcomesFor(sport);
      const index = outcomes.indexOf(winner);
      if (index < 0) continue;
      const ordered = toOrdered(probs, outcomes);
      if (ordered.some((p) => !Number.isFinite(p)) || ordered.reduce((s, p) => s + p, 0) <= 0) continue;
      const s = score(ordered, index);
      if (race) s.rps = null;
      let exactScore: boolean | null = null;
      let statsError: Record<string, { home: number; away: number; withinRange: boolean }> | null = null;
      if (modelKey === 'ensemble') {
        const forecast = parseJson<{ mostLikely?: { home: number; away: number } } | null>(final.scoreJson, null);
        if (forecast?.mostLikely && typeof result.homeScore === 'number' && typeof result.awayScore === 'number') {
          exactScore = forecast.mostLikely.home === result.homeScore && forecast.mostLikely.away === result.awayScore;
        }
        const stats = parseJson<StatForecasts | null>(final.statsJson, null);
        if (stats) {
          const homeActual = event.stats.find((r) => r.teamId === event.homeTeamId);
          const awayActual = event.stats.find((r) => r.teamId === event.awayTeamId);
          const h = homeActual ? parseJson<Record<string, number>>(homeActual.statsJson, {}) : {};
          const a = awayActual ? parseJson<Record<string, number>>(awayActual.statsJson, {}) : {};
          if (typeof result.homeScore === 'number') h.goals = h.goals ?? result.homeScore;
          if (typeof result.awayScore === 'number') a.goals = a.goals ?? result.awayScore;
          statsError = {};
          for (const [key, f] of Object.entries(stats)) {
            if (typeof h[key] !== 'number' || typeof a[key] !== 'number') continue;
            statsError[key] = {
              home: Math.round((h[key] - f.home.mean) * 100) / 100,
              away: Math.round((a[key] - f.away.mean) * 100) / 100,
              withinRange: h[key] >= f.home.low && h[key] <= f.home.high && a[key] >= f.away.low && a[key] <= f.away.high,
            };
          }
        }
      }
      await withDatabase(() =>
        prisma.$transaction([
          prisma.prediction.updateMany({ where: { eventId: event.id, modelKey }, data: { isFinal: false } }),
          prisma.prediction.update({ where: { id: final.id }, data: { isFinal: true } }),
          prisma.evaluation.create({
            data: {
              predictionId: final.id,
              eventId: event.id,
              modelKey,
              brier: s.brier,
              logLoss: s.logLoss,
              rps: s.rps,
              correct: s.correct,
              exactScore,
              statsErrorJson: statsError ? JSON.stringify(statsError) : null,
            },
          }),
        ]),
      );
      evaluations += 1;
    }
  }
  return { events: touched, evaluations };
}
