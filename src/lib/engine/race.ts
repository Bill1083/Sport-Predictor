/**
 * Predictions for multi-entrant events (races): load the competition's past
 * races with their finishing orders, run the race model for the target
 * event, and shape the result like any other prediction so it is stored,
 * shown and scored the same way.
 */

import { loadModelConfigs } from '@/lib/engine/config';
import type { ModelOutputs } from '@/lib/engine/predict';
import { DEFAULT_RACE_PARAMS, simulateRace, type PastRace, type RaceParams } from '@/lib/engine/sports/f1';
import { prisma, withDatabase } from '@/lib/prisma';
import type { SportKey } from '@/lib/sports/registry';
import type { ScoreForecast } from '@/lib/types';

export async function loadRaceHistory(competitionId: string, before: Date): Promise<PastRace[]> {
  const rows = await withDatabase(() =>
    prisma.event.findMany({
      where: { competitionId, status: 'FINISHED', startsAt: { lt: before } },
      include: { participants: { select: { teamId: true, finishPosition: true, gridPosition: true, statusNote: true } } },
      orderBy: { startsAt: 'asc' },
    }),
  );
  if (!rows.ok) return [];
  return rows.data.filter((r) => r.participants.length > 0).map((r) => ({ date: r.startsAt, results: r.participants }));
}

export async function computeRaceOutputs(sportKey: SportKey, event: { id: string; competitionId: string; startsAt: Date }): Promise<ModelOutputs | null> {
  const participants = await withDatabase(() =>
    prisma.eventParticipant.findMany({ where: { eventId: event.id, side: 'ENTRANT' }, include: { team: { select: { id: true, name: true } } } }),
  );
  if (!participants.ok || participants.data.length === 0) return null;
  const configs = await loadModelConfigs(sportKey);
  const params: RaceParams = { ...DEFAULT_RACE_PARAMS, ...((configs.get('race-sim')?.settings.params ?? {}) as Partial<RaceParams>) };
  const history = await loadRaceHistory(event.competitionId, event.startsAt);
  const entrants = participants.data.map((p) => ({ teamId: p.teamId, name: p.team.name, gridPosition: p.gridPosition }));
  const forecast = simulateRace(entrants, history, new Date(), params);
  if (forecast.entrants.length === 0) return null;

  // A grid-only baseline: pole wins a third of the time, the rest fades down the grid.
  const baseline: Record<string, number> = {};
  let total = 0;
  for (const e of entrants) {
    const grid = e.gridPosition ?? entrants.length / 2;
    baseline[e.teamId] = Math.exp(-0.35 * (grid - 1));
    total += baseline[e.teamId];
  }
  for (const key of Object.keys(baseline)) baseline[key] = Math.round((baseline[key] / total) * 10_000) / 10_000;

  const favourite = forecast.entrants[0];
  const score: ScoreForecast = {
    expected: { home: favourite.expectedPosition, away: 0 },
    mostLikely: { home: 1, away: 0, p: favourite.win },
    top: [],
    entrants: forecast.entrants.map((e) => ({
      teamId: e.teamId,
      name: e.name,
      win: Math.round(e.win * 10_000) / 10_000,
      podium: Math.round(e.podium * 10_000) / 10_000,
      points: Math.round(e.points * 10_000) / 10_000,
      expectedPosition: e.expectedPosition,
      dnf: Math.round(e.dnf * 10_000) / 10_000,
    })),
  };
  const maxP = Math.max(...Object.values(forecast.probs));
  return {
    probs: { 'race-sim': forecast.probs, baseline },
    score,
    stats: null,
    factors: [
      { key: 'pace', label: `${favourite.name} pace`, effect: Math.round(favourite.win * 100 * 10) / 10, note: `${history.length} past races weighed with decay`, source: 'model' },
      ...(entrants.some((e) => e.gridPosition) ? [{ key: 'grid', label: 'Grid known', effect: Math.round(params.gridWeight * 100) / 10, note: 'Qualifying positions shift pace by the grid weight', source: 'model' as const }] : []),
    ],
    features: {},
    ensemble: forecast.probs,
    confidence: Math.round(((maxP - 1 / entrants.length) / (1 - 1 / entrants.length)) * 100) / 100,
  };
}
