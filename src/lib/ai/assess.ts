/**
 * One AI assessment per event: build the stat pack, ask the configured
 * provider, record the call, and turn the reply into bounded factors, an
 * optional forecast (AI mode) and a narrative. Every guard lives here so a
 * model that returns nonsense can never move a prediction more than the
 * settings allow.
 */

import type { Event, Injury, Lineup } from '@prisma/client';

import { aiClient } from '@/lib/ai';
import { recordAiCall, withinBudget } from '@/lib/ai/cost';
import { headlinesFor, type Headline } from '@/lib/ai/news';
import { systemPrompt, userPrompt, type StatPack, type TeamPack } from '@/lib/ai/prompts';
import { aiAssessmentSchema, aiAssessmentValidator, MAX_FACTOR_EFFECT } from '@/lib/ai/schemas';
import { describeFailure } from '@/lib/ai/provider';
import { dcTeamProfile } from '@/lib/engine/dixon-coles';
import { eloRating } from '@/lib/engine/elo';
import { clipProbs } from '@/lib/engine/ensemble';
import { formOf, recentFor, type HistoryMatch } from '@/lib/engine/history';
import { normaliseProbs } from '@/lib/engine/math';
import type { ModelOutputs, SportModels } from '@/lib/engine/predict';
import { parseJson, prisma, withDatabase } from '@/lib/prisma';
import type { GlobalSettings } from '@/lib/settings';
import { outcomesFor } from '@/lib/sports/registry';
import { buildTable } from '@/lib/standings';
import { formatDateTime } from '@/lib/time';
import type { Factor, ProbMap, Weather } from '@/lib/types';

export interface AssessInput {
  event: Event & { homeTeam: { id: string; name: string } | null; awayTeam: { id: string; name: string } | null; competition: { id: string; name: string } };
  outputs: ModelOutputs;
  models: SportModels;
  mode: 'HYBRID' | 'AI';
  settings: GlobalSettings;
  runId?: string | null;
  log?: (line: string) => void;
}

export interface Assessment {
  /** Replacement ensemble probabilities (AI mode) or adjusted ones (hybrid). */
  probs: ProbMap;
  /** The AI's own probabilities before any guard, for the model-by-model view. */
  aiProbs: ProbMap;
  factors: Factor[];
  narrative: string | null;
  expectedScore: { home: number; away: number } | null;
  costUsd: number;
  note: string | null;
}

function recentText(history: HistoryMatch[], team: string, kickoff: Date, names: Map<string, string>): string[] {
  return recentFor(history, team, kickoff, 5).map((m) => {
    const isHome = m.home === team;
    const opponent = names.get(isHome ? m.away : m.home) ?? 'opponent';
    const mine = isHome ? m.homeScore : m.awayScore;
    const theirs = isHome ? m.awayScore : m.homeScore;
    const result = mine > theirs ? 'W' : mine < theirs ? 'L' : 'D';
    return `${result} ${mine}-${theirs} v ${opponent} (${isHome ? 'h' : 'a'})`;
  });
}

function restDays(history: HistoryMatch[], team: string, kickoff: Date): number | null {
  const last = recentFor(history, team, kickoff, 1)[0];
  return last ? Math.round((kickoff.getTime() - last.date.getTime()) / 86_400_000) : null;
}

function lineupText(lineup: Lineup | undefined): TeamPack['lineup'] {
  if (!lineup) return null;
  const starters = parseJson<{ name: string; position?: string }[]>(lineup.startersJson, []);
  return { formation: lineup.formation, confirmed: lineup.confirmed, starters: starters.map((s) => (s.position ? `${s.name} (${s.position})` : s.name)) };
}

function injuryText(rows: Injury[]): string[] {
  return rows.map((i) => `${i.playerName}: ${i.status.toLowerCase()}${i.reason ? `, ${i.reason}` : i.type ? `, ${i.type}` : ''}${i.expectedReturn ? `, back ${i.expectedReturn.toISOString().slice(0, 10)}` : ''}`);
}

function weatherText(raw: string | null): string | null {
  const w = parseJson<Weather | null>(raw, null);
  if (!w || w.tempC === undefined) return null;
  return `${Math.round(w.tempC)}C${w.windKph !== undefined ? `, wind ${Math.round(w.windKph)} km/h` : ''}${w.rainProb !== undefined ? `, ${Math.round(w.rainProb)}% chance of rain` : ''}${w.conditions ? `, ${w.conditions}` : ''}`;
}

/** Shift the home probability by `pp` points, sharing the difference across the other outcomes proportionally. */
export function shiftHome(probs: ProbMap, pp: number, outcomes: string[]): ProbMap {
  const home = probs.HOME ?? 0;
  const target = Math.min(0.95, Math.max(0.03, home + pp / 100));
  const others = outcomes.filter((o) => o !== 'HOME');
  const otherTotal = others.reduce((s, o) => s + (probs[o] ?? 0), 0);
  const out: ProbMap = { HOME: target };
  for (const o of others) out[o] = otherTotal > 0 ? ((probs[o] ?? 0) / otherTotal) * (1 - target) : (1 - target) / others.length;
  return normaliseProbs(out);
}

export async function buildStatPack(input: AssessInput): Promise<StatPack | null> {
  const { event, outputs, models, settings } = input;
  if (!event.homeTeam || !event.awayTeam) return null;
  const kickoff = event.startsAt;
  const history = models.history;
  const names = new Map<string, string>();
  const teamRows = await withDatabase(() => prisma.team.findMany({ where: { sportKey: event.sportKey }, select: { id: true, name: true } }));
  for (const t of teamRows.ok ? teamRows.data : []) names.set(t.id, t.name);

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
  const [injuries, lineups] = await Promise.all([
    withDatabase(() => prisma.injury.findMany({ where: { teamId: { in: [event.homeTeam!.id, event.awayTeam!.id] }, resolvedAt: null } })),
    withDatabase(() => prisma.lineup.findMany({ where: { eventId: event.id } })),
  ]);
  const dc = models.dc.get(event.competitionId);

  const team = async (id: string, name: string): Promise<TeamPack> => {
    const row = table.find((r) => r.teamId === id);
    const profile = dc ? dcTeamProfile(dc, id) : null;
    const headlines: Headline[] = settings.aiContext ? await headlinesFor(id, name, event.sportKey) : [];
    return {
      name,
      position: row?.position ?? null,
      played: row?.played ?? null,
      points: row?.points ?? null,
      form: row?.form ?? formOf(recentFor(history, id, kickoff, 5), id).ppg.toFixed(2),
      elo: eloRating(models.elo, id),
      attack: profile?.attack ?? null,
      defence: profile?.defence ?? null,
      recent: recentText(history, id, kickoff, names),
      injuries: injuryText((injuries.ok ? injuries.data : []).filter((i) => i.teamId === id)),
      lineup: lineupText((lineups.ok ? lineups.data : []).find((l) => l.teamId === id)),
      restDays: restDays(history, id, kickoff),
      headlines: headlines.slice(0, 8),
    };
  };

  const h2h = history
    .filter((m) => m.date < kickoff && ((m.home === event.homeTeamId && m.away === event.awayTeamId) || (m.home === event.awayTeamId && m.away === event.homeTeamId)))
    .slice(-5)
    .reverse()
    .map((m) => `${names.get(m.home) ?? 'home'} ${m.homeScore}-${m.awayScore} ${names.get(m.away) ?? 'away'} (${m.date.toISOString().slice(0, 10)})`);

  const venue = event.venueId ? await withDatabase(() => prisma.venue.findUnique({ where: { id: event.venueId! } })) : null;
  return {
    sport: models.sport.name,
    competition: event.competition.name,
    season: event.season,
    round: event.round,
    kickoff: formatDateTime(kickoff),
    venue: venue && venue.ok && venue.data ? `${venue.data.name}${venue.data.city ? `, ${venue.data.city}` : ''}` : null,
    weather: weatherText(event.weatherJson),
    home: await team(event.homeTeam.id, event.homeTeam.name),
    away: await team(event.awayTeam.id, event.awayTeam.name),
    headToHead: h2h,
    algorithm: {
      probabilities: outputs.ensemble,
      expectedScore: outputs.score?.expected ?? null,
      mostLikely: outputs.score?.mostLikely ?? null,
      factors: outputs.factors,
    },
  };
}

export async function assessEvent(input: AssessInput): Promise<Assessment | null> {
  const { settings, mode, models, outputs } = input;
  const client = aiClient(settings.aiProvider);
  if (!client || !client.configured()) return null;
  const budget = await withinBudget();
  if (!budget.ok) {
    input.log?.(`AI skipped: monthly budget spent (${budget.spent.toFixed(2)} of ${budget.budget.toFixed(2)} USD)`);
    return null;
  }
  const pack = await buildStatPack(input);
  if (!pack) return null;
  const outcomes: string[] = outcomesFor(models.sport);
  const model = settings.aiProvider === 'anthropic' ? settings.anthropicModel : settings.geminiModel;

  const outcome = await client.generate({
    purpose: mode === 'AI' ? 'predict' : 'adjust',
    system: systemPrompt(models.sport, mode),
    prompt: userPrompt(pack),
    schema: aiAssessmentSchema,
    validator: aiAssessmentValidator,
    model,
    effort: settings.aiEffort,
    maxOutputTokens: 2_048,
  });
  const costUsd = await recordAiCall(outcome, {
    purpose: mode === 'AI' ? 'predict' : 'adjust',
    eventId: input.event.id,
    runId: input.runId,
    priceInputPerM: settings.priceInputPerM,
    priceOutputPerM: settings.priceOutputPerM,
  });
  if (!outcome.ok) {
    input.log?.(`AI ${outcome.code} for ${input.event.id}: ${outcome.reason}`);
    return { probs: outputs.ensemble, aiProbs: {}, factors: [], narrative: null, expectedScore: null, costUsd, note: describeFailure(outcome.code) };
  }

  const data = outcome.data;
  // Guards: each factor bounded, the total bounded by the configured cap.
  const factors: Factor[] = data.factors.map((f) => ({
    key: `ai_${f.key.replace(/[^a-z0-9_]/gi, '_').slice(0, 30)}`,
    label: f.label.slice(0, 60),
    effect: Math.round(Math.max(-MAX_FACTOR_EFFECT, Math.min(MAX_FACTOR_EFFECT, f.effect)) * 10) / 10,
    note: `${f.note}${f.confidence !== 'high' ? ` (${f.confidence} confidence)` : ''}`,
    source: 'ai',
  }));
  const rawTotal = factors.reduce((s, f) => s + f.effect, 0);
  const cap = settings.aiAdjustmentCap;
  const total = Math.max(-cap, Math.min(cap, rawTotal));
  if (Math.abs(rawTotal) > cap && rawTotal !== 0) {
    const scale = total / rawTotal;
    for (const f of factors) f.effect = Math.round(f.effect * scale * 10) / 10;
  }

  let aiProbs: ProbMap = {};
  let probs: ProbMap;
  if (mode === 'AI' && data.probabilities) {
    const raw: ProbMap = { HOME: data.probabilities.HOME, AWAY: data.probabilities.AWAY };
    if (outcomes.includes('DRAW')) raw.DRAW = data.probabilities.DRAW ?? Math.max(0, 1 - raw.HOME - raw.AWAY);
    aiProbs = normaliseProbs(raw);
    probs = clipProbs(aiProbs);
  } else {
    probs = shiftHome(outputs.ensemble, total, outcomes);
    aiProbs = probs;
  }
  return {
    probs,
    aiProbs,
    factors,
    narrative: settings.aiNarratives ? data.narrative.trim() || null : null,
    expectedScore: mode === 'AI' && data.expectedScore ? data.expectedScore : null,
    costUsd,
    note: null,
  };
}
