/**
 * Model configuration: which models run for a sport, their parameters,
 * their ensemble weight, and the fitted state the refit job stored.
 * Defaults live here; the Lab edits rows in `model_configs`, and a
 * competition-specific row (competitionId set) overrides the sport-wide one.
 */

import { DEFAULT_DC_PARAMS, type DcParams } from '@/lib/engine/dixon-coles';
import { DEFAULT_ELO_PARAMS, type EloParams } from '@/lib/engine/elo';
import { DEFAULT_LOGISTIC_PARAMS, type LogisticParams } from '@/lib/engine/logistic';
import { DEFAULT_STAT_PARAMS, type StatParams } from '@/lib/engine/stats-model';
import { parseJson, prisma, withDatabase } from '@/lib/prisma';
import type { SportKey } from '@/lib/sports/registry';

export interface EnsembleParams {
  temperature: number;
  clipFloor: number;
  clipCeil: number;
}

export interface ModelSettings {
  key: string;
  label: string;
  enabled: boolean;
  /** Ensemble weight; 0 means "run and show, but do not blend". */
  weight: number;
  params: Record<string, unknown>;
  /** What the parameters mean, for the Lab. */
  help: string;
}

const ELO_FOR = (sport: SportKey): EloParams => {
  switch (sport) {
    case 'rugby_union':
    case 'rugby_league':
      return { ...DEFAULT_ELO_PARAMS, k: 24, homeAdvantage: 70, drawBase: 0.04, drawSlope: 1.5 };
    case 'cricket':
      return { ...DEFAULT_ELO_PARAMS, k: 26, homeAdvantage: 45, drawBase: 0.08, drawSlope: 1.2, marginMultiplier: false };
    case 'tennis':
      return { ...DEFAULT_ELO_PARAMS, k: 32, homeAdvantage: 0, drawBase: 0, seasonRegression: 0.15, marginMultiplier: false };
    case 'basketball':
      return { ...DEFAULT_ELO_PARAMS, k: 20, homeAdvantage: 80, drawBase: 0 };
    case 'american_football':
      return { ...DEFAULT_ELO_PARAMS, k: 20, homeAdvantage: 55, drawBase: 0.005, drawSlope: 2 };
    case 'ice_hockey':
    case 'baseball':
      return { ...DEFAULT_ELO_PARAMS, k: 8, homeAdvantage: 35, drawBase: 0 };
    default:
      return DEFAULT_ELO_PARAMS;
  }
};

export function defaultModelSettings(sport: SportKey): ModelSettings[] {
  const list: ModelSettings[] = [
    {
      key: 'baseline',
      label: 'Home-advantage baseline',
      enabled: true,
      weight: 0,
      params: {},
      help: 'The league\'s own home / draw / away frequencies. Every model must beat this.',
    },
    {
      key: 'elo',
      label: 'Elo rating',
      enabled: true,
      weight: 0.3,
      params: { ...ELO_FOR(sport) },
      help: 'k: how fast ratings move. homeAdvantage: rating points for the home side. seasonRegression: share given back each new season. drawBase: draw share for level sides (fitted at refit).',
    },
  ];
  if (sport === 'football' || sport === 'ice_hockey' || sport === 'baseball') {
    list.push({
      key: 'dixon-coles',
      label: sport === 'football' ? 'Dixon-Coles' : 'Poisson goals',
      enabled: true,
      weight: 0.5,
      params: { ...DEFAULT_DC_PARAMS } satisfies DcParams,
      help: 'xi: time decay per day (0.0018 halves a match\'s weight in about a year). l2: pull toward the league average for thin samples.',
    });
  } else {
    list.push({
      key: 'margin',
      label: 'Margin model',
      enabled: true,
      weight: 0.5,
      params: { xi: 0.002, sigma: null },
      help: 'Expected margin from the rating gap plus home advantage; sigma is the spread of margins, fitted at refit.',
    });
  }
  list.push(
    {
      key: 'stats',
      label: 'Stat forecasts',
      enabled: true,
      weight: 0,
      params: { ...DEFAULT_STAT_PARAMS } satisfies StatParams,
      help: 'Ratio-of-averages per stat. shrink: pseudo-games pulling a team to the league mean.',
    },
    {
      key: 'ml',
      label: 'Feature model',
      enabled: true,
      weight: 0.2,
      params: { ...DEFAULT_LOGISTIC_PARAMS } satisfies LogisticParams,
      help: 'Multinomial logistic regression over rating gap, form, rest, head-to-head, table position and absences. Trained at refit from a walk-forward pass; skipped until 200 rows exist.',
    },
    {
      key: 'ai',
      label: 'AI',
      enabled: true,
      weight: 0.15,
      params: {},
      help: 'The language model\'s own forecast (AI mode) or its bounded adjustments (hybrid mode). Needs a provider key.',
    },
    {
      key: 'ensemble',
      label: 'Ensemble',
      enabled: true,
      weight: 1,
      params: { temperature: 1, clipFloor: 0.02, clipCeil: 0.96 } satisfies EnsembleParams,
      help: 'Log-linear blend of the models above by weight, then temperature-scaled (fitted at refit) and clipped.',
    },
  );
  return list;
}

export interface LoadedModel {
  settings: ModelSettings;
  /** Fitted state JSON as stored by refit, if any. */
  state: string | null;
  fittedAt: Date | null;
  /** Whether a competition-specific row was used. */
  competitionSpecific: boolean;
}

/**
 * Configs for a sport, with competition-specific rows (when `competitionId`
 * is given) laid over the sport-wide ones, which in turn lay over defaults.
 */
export async function loadModelConfigs(sportKey: SportKey, competitionId = ''): Promise<Map<string, LoadedModel>> {
  const rows = await withDatabase(() =>
    prisma.modelConfig.findMany({ where: { sportKey, competitionId: { in: competitionId ? ['', competitionId] : [''] } } }),
  );
  const out = new Map<string, LoadedModel>();
  for (const settings of defaultModelSettings(sportKey)) {
    out.set(settings.key, { settings, state: null, fittedAt: null, competitionSpecific: false });
  }
  const apply = (scopeId: string) => {
    for (const row of rows.ok ? rows.data : []) {
      if (row.competitionId !== scopeId) continue;
      const current = out.get(row.modelKey);
      if (!current) continue;
      const params = parseJson<Record<string, unknown>>(row.paramsJson, {});
      out.set(row.modelKey, {
        settings: { ...current.settings, enabled: row.enabled, weight: row.weight, params: { ...current.settings.params, ...params } },
        state: row.stateJson ?? current.state,
        fittedAt: row.fittedAt ?? current.fittedAt,
        competitionSpecific: scopeId !== '',
      });
    }
  };
  apply('');
  if (competitionId) apply(competitionId);
  return out;
}

export async function saveModelState(sportKey: string, competitionId: string, modelKey: string, state: unknown, paramsPatch?: Record<string, unknown>): Promise<void> {
  const existing = await withDatabase(() =>
    prisma.modelConfig.findUnique({ where: { sportKey_competitionId_modelKey: { sportKey, competitionId, modelKey } } }),
  );
  const params = { ...parseJson<Record<string, unknown>>(existing.ok && existing.data ? existing.data.paramsJson : '{}', {}), ...(paramsPatch ?? {}) };
  await withDatabase(() =>
    prisma.modelConfig.upsert({
      where: { sportKey_competitionId_modelKey: { sportKey, competitionId, modelKey } },
      create: { sportKey, competitionId, modelKey, paramsJson: JSON.stringify(params), stateJson: JSON.stringify(state), fittedAt: new Date() },
      update: { paramsJson: JSON.stringify(params), stateJson: JSON.stringify(state), fittedAt: new Date() },
    }),
  );
}

export async function updateModelConfig(
  sportKey: string,
  modelKey: string,
  patch: { enabled?: boolean; weight?: number; params?: Record<string, unknown> },
  competitionId = '',
): Promise<void> {
  const existing = await withDatabase(() =>
    prisma.modelConfig.findUnique({ where: { sportKey_competitionId_modelKey: { sportKey, competitionId, modelKey } } }),
  );
  const params = { ...parseJson<Record<string, unknown>>(existing.ok && existing.data ? existing.data.paramsJson : '{}', {}), ...(patch.params ?? {}) };
  await withDatabase(() =>
    prisma.modelConfig.upsert({
      where: { sportKey_competitionId_modelKey: { sportKey, competitionId, modelKey } },
      create: { sportKey, competitionId, modelKey, paramsJson: JSON.stringify(params), weight: patch.weight ?? 1, enabled: patch.enabled ?? true },
      update: { paramsJson: JSON.stringify(params), ...(patch.weight !== undefined ? { weight: patch.weight } : {}), ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}) },
    }),
  );
}

/** Forget everything fitted for a sport (the Lab's "reset models"). */
export async function resetModelConfigs(sportKey: string): Promise<void> {
  await withDatabase(() => prisma.modelConfig.deleteMany({ where: { sportKey } }));
}
