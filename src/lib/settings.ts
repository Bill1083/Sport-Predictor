/**
 * Runtime settings.
 *
 * Two scopes: `global` (the AI provider, prices, budgets, schedule) and one
 * per sport (prediction mode, sync cadences, provider preference). A value
 * that has never been written falls back to the `.env` seed, so a fresh
 * install starts exactly as the env file says and the dashboard owns the
 * value from then on.
 */

import { z } from 'zod';

import { env, type AiProviderKey, type PredictionMode } from '@/lib/env';
import { prisma, withDatabase } from '@/lib/prisma';
import { formatRunTimes, parseRunTimes } from '@/lib/time';

export const GLOBAL_SCOPE = 'global';

export type AiEffort = 'low' | 'medium' | 'high';

export interface GlobalSettings {
  aiProvider: AiProviderKey;
  geminiModel: string;
  anthropicModel: string;
  priceInputPerM: number;
  priceOutputPerM: number;
  aiMonthlyBudgetUsd: number;
  aiEffort: AiEffort;
  /** Write a narrative for every prediction (costs one call per event). */
  aiNarratives: boolean;
  /** Read headlines and injury lists into structured context before predicting. */
  aiContext: boolean;
  predictHorizonDays: number;
  refitTime: string;
  fixtureSyncTime: string;
  oddsEnabled: boolean;
  /** Bound on the total AI adjustment in hybrid mode, in probability points. */
  aiAdjustmentCap: number;
}

export interface SportSettings {
  mode: PredictionMode;
  /** Minutes between result polls while events are live or recently finished. */
  resultsPollMinutes: number;
  /** Hours before kickoff that context (injuries, standings, news) is refreshed. */
  contextHoursBefore: number;
  /** Minutes before kickoff that lineups are fetched and the final prediction made. */
  lineupMinutesBefore: number;
  /** Comma-separated provider keys in preference order, e.g. "football-data,api-sports". */
  providerOrder: string;
  /** Fetch a weather forecast for outdoor venues. */
  weather: boolean;
}

interface Codec<T> {
  parse: (raw: string) => T | undefined;
  serialize: (value: T) => string;
  fallback: () => T;
}

function intCodec(fallback: () => number, min: number, max: number): Codec<number> {
  return {
    parse: (raw) => {
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
    },
    serialize: (v) => String(Math.round(v)),
    fallback,
  };
}

function floatCodec(fallback: () => number, min: number, max: number): Codec<number> {
  return {
    parse: (raw) => {
      const n = Number.parseFloat(raw);
      return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
    },
    serialize: (v) => String(v),
    fallback,
  };
}

function boolCodec(fallback: () => boolean): Codec<boolean> {
  return {
    parse: (raw) => (raw === 'true' ? true : raw === 'false' ? false : undefined),
    serialize: (v) => (v ? 'true' : 'false'),
    fallback,
  };
}

function stringCodec(fallback: () => string, max = 10_000): Codec<string> {
  return {
    parse: (raw) => raw.slice(0, max),
    serialize: (v) => v,
    fallback,
  };
}

function enumCodec<T extends string>(values: readonly T[], fallback: () => T): Codec<T> {
  return {
    parse: (raw) => (values.includes(raw as T) ? (raw as T) : undefined),
    serialize: (v) => v,
    fallback,
  };
}

function timeCodec(fallback: () => string): Codec<string> {
  return {
    parse: (raw) => {
      const parsed = parseRunTimes(raw);
      return parsed.length > 0 ? formatRunTimes(parsed.slice(0, 1)) : undefined;
    },
    serialize: (v) => formatRunTimes(parseRunTimes(v).slice(0, 1)),
    fallback: () => formatRunTimes(parseRunTimes(fallback()).slice(0, 1)) || '03:00',
  };
}

const GLOBAL_CODECS: { [K in keyof GlobalSettings]: Codec<GlobalSettings[K]> } = {
  aiProvider: enumCodec(['gemini', 'anthropic', 'none'] as const, () => env.aiProvider),
  geminiModel: stringCodec(() => env.geminiModel, 80),
  anthropicModel: stringCodec(() => env.anthropicModel, 80),
  priceInputPerM: floatCodec(() => env.aiPriceInputPerM, 0, 1_000),
  priceOutputPerM: floatCodec(() => env.aiPriceOutputPerM, 0, 1_000),
  aiMonthlyBudgetUsd: floatCodec(() => env.aiMonthlyBudgetUsd, 0, 10_000),
  aiEffort: enumCodec(['low', 'medium', 'high'] as const, () => 'low'),
  aiNarratives: boolCodec(() => true),
  aiContext: boolCodec(() => true),
  predictHorizonDays: intCodec(() => env.predictHorizonDays, 1, 60),
  refitTime: timeCodec(() => env.refitTime),
  fixtureSyncTime: timeCodec(() => env.fixtureSyncTime),
  oddsEnabled: boolCodec(() => env.oddsEnabled),
  aiAdjustmentCap: floatCodec(() => 10, 0, 30),
};

const SPORT_CODECS: { [K in keyof SportSettings]: Codec<SportSettings[K]> } = {
  mode: enumCodec(['ALGORITHM', 'AI', 'HYBRID'] as const, () => env.defaultPredictionMode),
  resultsPollMinutes: intCodec(() => 15, 5, 1_440),
  contextHoursBefore: intCodec(() => 24, 1, 168),
  lineupMinutesBefore: intCodec(() => 90, 15, 720),
  providerOrder: stringCodec(() => '', 200),
  weather: boolCodec(() => true),
};

const GLOBAL_KEYS = Object.keys(GLOBAL_CODECS) as (keyof GlobalSettings)[];
const SPORT_KEYS = Object.keys(SPORT_CODECS) as (keyof SportSettings)[];

function resolve<T extends object>(
  codecs: { [K in keyof T]: Codec<T[K]> },
  keys: (keyof T)[],
  stored: Record<string, string>,
): T {
  const out = {} as T;
  for (const key of keys) {
    const codec = codecs[key];
    const raw = stored[key as string];
    const parsed = raw === undefined ? undefined : (codec.parse as (raw: string) => unknown)(raw);
    (out as Record<string, unknown>)[key as string] = parsed === undefined ? codec.fallback() : parsed;
  }
  return out;
}

export function defaultGlobalSettings(): GlobalSettings {
  return resolve(GLOBAL_CODECS, GLOBAL_KEYS, {});
}

export function defaultSportSettings(): SportSettings {
  return resolve(SPORT_CODECS, SPORT_KEYS, {});
}

/** Pure merge of stored rows over the defaults; unknown keys and bad values are ignored. */
export function resolveGlobalSettings(stored: Record<string, string>): GlobalSettings {
  return resolve(GLOBAL_CODECS, GLOBAL_KEYS, stored);
}

export function resolveSportSettings(stored: Record<string, string>): SportSettings {
  return resolve(SPORT_CODECS, SPORT_KEYS, stored);
}

async function rowsFor(scope: string): Promise<Record<string, string>> {
  const rows = await withDatabase(() => prisma.setting.findMany({ where: { scope } }));
  if (!rows.ok) return {};
  return Object.fromEntries(rows.data.map((row) => [row.key, row.value]));
}

export async function getGlobalSettings(): Promise<GlobalSettings> {
  return resolveGlobalSettings(await rowsFor(GLOBAL_SCOPE));
}

export async function getSportSettings(sportKey: string): Promise<SportSettings> {
  return resolveSportSettings(await rowsFor(sportKey));
}

/** Several sports' settings in a single query. */
export async function getSettingsForSports(sportKeys: string[]): Promise<Map<string, SportSettings>> {
  const out = new Map<string, SportSettings>();
  if (sportKeys.length === 0) return out;
  const rows = await withDatabase(() => prisma.setting.findMany({ where: { scope: { in: sportKeys } } }));
  const byScope = new Map<string, Record<string, string>>();
  for (const row of rows.ok ? rows.data : []) {
    const entry = byScope.get(row.scope) ?? {};
    entry[row.key] = row.value;
    byScope.set(row.scope, entry);
  }
  for (const key of sportKeys) out.set(key, resolveSportSettings(byScope.get(key) ?? {}));
  return out;
}

async function write<T extends object>(
  scope: string,
  codecs: { [K in keyof T]: Codec<T[K]> },
  keys: (keyof T)[],
  patch: Partial<T>,
): Promise<void> {
  const writes = [];
  for (const key of keys) {
    const value = patch[key];
    if (value === undefined) continue;
    const serialized = (codecs[key].serialize as (value: unknown) => string)(value);
    writes.push(
      prisma.setting.upsert({
        where: { scope_key: { scope, key: key as string } },
        create: { scope, key: key as string, value: serialized },
        update: { value: serialized },
      }),
    );
  }
  if (writes.length > 0) await prisma.$transaction(writes);
}

export async function updateGlobalSettings(patch: Partial<GlobalSettings>): Promise<GlobalSettings> {
  await write(GLOBAL_SCOPE, GLOBAL_CODECS, GLOBAL_KEYS, patch);
  return getGlobalSettings();
}

export async function updateSportSettings(sportKey: string, patch: Partial<SportSettings>): Promise<SportSettings> {
  await write(sportKey, SPORT_CODECS, SPORT_KEYS, patch);
  return getSportSettings(sportKey);
}

export async function deleteSportSettings(sportKey: string): Promise<void> {
  await withDatabase(() => prisma.setting.deleteMany({ where: { scope: sportKey } }));
}

/** Request body contract for PATCH /api/settings (global scope). */
export const globalSettingsPatchSchema = z
  .object({
    aiProvider: z.enum(['gemini', 'anthropic', 'none']),
    geminiModel: z.string().trim().min(1).max(80),
    anthropicModel: z.string().trim().min(1).max(80),
    priceInputPerM: z.number().min(0).max(1_000),
    priceOutputPerM: z.number().min(0).max(1_000),
    aiMonthlyBudgetUsd: z.number().min(0).max(10_000),
    aiEffort: z.enum(['low', 'medium', 'high']),
    aiNarratives: z.boolean(),
    aiContext: z.boolean(),
    predictHorizonDays: z.number().int().min(1).max(60),
    refitTime: z.string().max(10),
    fixtureSyncTime: z.string().max(10),
    oddsEnabled: z.boolean(),
    aiAdjustmentCap: z.number().min(0).max(30),
  })
  .partial()
  .strict();

/** Request body contract for PATCH /api/settings?scope=<sport>. */
export const sportSettingsPatchSchema = z
  .object({
    mode: z.enum(['ALGORITHM', 'AI', 'HYBRID']),
    resultsPollMinutes: z.number().int().min(5).max(1_440),
    contextHoursBefore: z.number().int().min(1).max(168),
    lineupMinutesBefore: z.number().int().min(15).max(720),
    providerOrder: z.string().max(200),
    weather: z.boolean(),
  })
  .partial()
  .strict();

export type GlobalSettingsPatch = z.infer<typeof globalSettingsPatchSchema>;
export type SportSettingsPatch = z.infer<typeof sportSettingsPatchSchema>;
