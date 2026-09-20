/**
 * Row -> DTO conversions. Prisma rows never reach a client component raw:
 * dates become ISO strings and JSON columns are parsed once, here.
 */

import type { Competition, Event, ModelRun, Prediction, Sport, Team, Venue } from '@prisma/client';

import { parseJson } from '@/lib/prisma';
import type { SportIconKey } from '@/lib/sports/registry';
import { sportDefinition } from '@/lib/sports/registry';
import { parseResult, type EventResult, type Factor, type ProbMap, type ScoreForecast, type StatForecasts, type Weather } from '@/lib/types';

export interface SportDto {
  key: string;
  name: string;
  enabled: boolean;
  mode: string;
  icon: SportIconKey;
  hasDraws: boolean;
  phase: number;
  description: string;
}

export function serializeSport(sport: Sport): SportDto {
  const definition = sportDefinition(sport.key);
  return {
    key: sport.key,
    name: sport.name,
    enabled: sport.enabled,
    mode: sport.mode,
    icon: definition?.icon ?? 'football',
    hasDraws: definition?.hasDraws ?? true,
    phase: definition?.phase ?? 3,
    description: definition?.description ?? '',
  };
}

export interface CompetitionDto {
  id: string;
  sportKey: string;
  slug: string;
  name: string;
  shortName: string | null;
  country: string | null;
  type: string;
  currentSeason: string | null;
  followed: boolean;
  tier: number;
  logoUrl: string | null;
  providerIds: Record<string, string>;
  lastSyncedAt: string | null;
}

export function serializeCompetition(c: Competition): CompetitionDto {
  return {
    id: c.id,
    sportKey: c.sportKey,
    slug: c.slug,
    name: c.name,
    shortName: c.shortName,
    country: c.country,
    type: c.type,
    currentSeason: c.currentSeason,
    followed: c.followed,
    tier: c.tier,
    logoUrl: c.logoUrl,
    providerIds: parseJson<Record<string, string>>(c.providerIdsJson, {}),
    lastSyncedAt: c.lastSyncedAt ? c.lastSyncedAt.toISOString() : null,
  };
}

export interface TeamDto {
  id: string;
  sportKey: string;
  kind: string;
  name: string;
  shortName: string | null;
  code: string | null;
  country: string | null;
  crestUrl: string | null;
  venue: { name: string; city: string | null; lat: number | null; lon: number | null; capacity: number | null } | null;
}

export function serializeTeam(t: Team & { venue?: Venue | null }): TeamDto {
  return {
    id: t.id,
    sportKey: t.sportKey,
    kind: t.kind,
    name: t.name,
    shortName: t.shortName,
    code: t.code,
    country: t.country,
    crestUrl: t.crestUrl,
    venue: t.venue ? { name: t.venue.name, city: t.venue.city, lat: t.venue.lat, lon: t.venue.lon, capacity: t.venue.capacity } : null,
  };
}

export interface PredictionDto {
  id: string;
  eventId: string;
  modelKey: string;
  version: number;
  mode: string;
  minutesToKickoff: number | null;
  probs: ProbMap;
  score: ScoreForecast | null;
  stats: StatForecasts | null;
  factors: Factor[];
  narrative: string | null;
  confidence: number | null;
  isFinal: boolean;
  createdAt: string;
}

export function serializePrediction(p: Prediction): PredictionDto {
  return {
    id: p.id,
    eventId: p.eventId,
    modelKey: p.modelKey,
    version: p.version,
    mode: p.mode,
    minutesToKickoff: p.minutesToKickoff,
    probs: parseJson<ProbMap>(p.probsJson, {}),
    score: parseJson<ScoreForecast | null>(p.scoreJson, null),
    stats: parseJson<StatForecasts | null>(p.statsJson, null),
    factors: parseJson<Factor[]>(p.factorsJson, []),
    narrative: p.narrative,
    confidence: p.confidence,
    isFinal: p.isFinal,
    createdAt: p.createdAt.toISOString(),
  };
}

export interface EventDto {
  id: string;
  sportKey: string;
  competition: { id: string; name: string; shortName: string | null; slug: string };
  season: string;
  round: string | null;
  stage: string | null;
  startsAt: string;
  status: string;
  minute: number | null;
  format: string | null;
  referee: string | null;
  venue: { name: string; city: string | null } | null;
  home: TeamDto | null;
  away: TeamDto | null;
  result: EventResult;
  weather: Weather | null;
  /** The latest ensemble prediction, when one exists. */
  prediction: PredictionDto | null;
}

export type EventWithRelations = Event & {
  competition: Competition;
  homeTeam: (Team & { venue?: Venue | null }) | null;
  awayTeam: (Team & { venue?: Venue | null }) | null;
  venue?: Venue | null;
  predictions?: Prediction[];
};

export function serializeEvent(e: EventWithRelations): EventDto {
  const ensemble = (e.predictions ?? [])
    .filter((p) => p.modelKey === 'ensemble')
    .sort((a, b) => b.version - a.version)[0];
  return {
    id: e.id,
    sportKey: e.sportKey,
    competition: { id: e.competition.id, name: e.competition.name, shortName: e.competition.shortName, slug: e.competition.slug },
    season: e.season,
    round: e.round,
    stage: e.stage,
    startsAt: e.startsAt.toISOString(),
    status: e.status,
    minute: e.minute,
    format: e.format,
    referee: e.referee,
    venue: e.venue ? { name: e.venue.name, city: e.venue.city } : null,
    home: e.homeTeam ? serializeTeam(e.homeTeam) : null,
    away: e.awayTeam ? serializeTeam(e.awayTeam) : null,
    result: parseResult(e.resultJson),
    weather: parseJson<Weather | null>(e.weatherJson, null),
    prediction: ensemble ? serializePrediction(ensemble) : null,
  };
}

export interface RunDto {
  id: string;
  kind: string;
  job: string;
  sportKey: string | null;
  competitionId: string | null;
  trigger: string;
  status: string;
  phase: string;
  progressDone: number;
  progressTotal: number;
  metrics: Record<string, unknown> | null;
  error: string | null;
  /** The last log line, e.g. "OK: 42 events across 2 competitions (3s)". */
  summary: string | null;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
}

export function serializeRun(r: ModelRun): RunDto {
  const lastLine = r.log.trim().split('\n').pop() ?? '';
  return {
    summary: lastLine ? lastLine.replace(/^\d\d:\d\d:\d\d /, '') : null,
    id: r.id,
    kind: r.kind,
    job: r.job,
    sportKey: r.sportKey,
    competitionId: r.competitionId,
    trigger: r.trigger,
    status: r.status,
    phase: r.phase,
    progressDone: r.progressDone,
    progressTotal: r.progressTotal,
    metrics: parseJson<Record<string, unknown> | null>(r.metricsJson, null),
    error: r.error,
    costUsd: r.costUsd,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  };
}

/** Standard include for event queries that feed serializeEvent. */
export const EVENT_INCLUDE = {
  competition: true,
  homeTeam: { include: { venue: true } },
  awayTeam: { include: { venue: true } },
  venue: true,
  predictions: { where: { modelKey: 'ensemble' }, orderBy: { version: 'desc' as const }, take: 1 },
} as const;
