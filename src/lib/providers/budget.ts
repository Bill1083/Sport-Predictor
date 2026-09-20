/**
 * Per-provider daily request budgets.
 *
 * Free tiers are counted per day (API-Sports: 100), per minute
 * (football-data.org: 10) or not at all. The ledger records every request
 * made against each provider per calendar day (APP_TIMEZONE) so a job can
 * refuse to start work it cannot finish, and the Today page can show what is
 * used. Pacing between requests lives in http.ts.
 */

import { env } from '@/lib/env';
import { prisma, withDatabase } from '@/lib/prisma';
import type { ProviderKey } from '@/lib/providers/provider';
import { dayKey } from '@/lib/time';

export interface ProviderBudget {
  provider: ProviderKey;
  label: string;
  /** Requests allowed per day; 0 means unlimited (still paced). */
  dailyBudget: number;
  /** Minimum gap between requests, for per-minute limits. */
  minGapMs: number;
  /** Whether the provider needs a key and has one. */
  configured: boolean;
  docsUrl?: string;
}

export function providerBudgets(): ProviderBudget[] {
  return [
    { provider: 'mock', label: 'Demo leagues', dailyBudget: 0, minGapMs: 0, configured: env.mockSports },
    {
      provider: 'football-data',
      label: 'football-data.org',
      dailyBudget: env.budgetFootballData,
      // Free tier: 10 requests per minute.
      minGapMs: 6_500,
      configured: Boolean(env.footballDataApiKey),
      docsUrl: 'https://www.football-data.org/client/register',
    },
    {
      provider: 'api-sports',
      label: 'API-Sports',
      dailyBudget: env.budgetApiSports,
      minGapMs: 250,
      configured: Boolean(env.apiSportsKey),
      docsUrl: 'https://dashboard.api-football.com',
    },
    {
      provider: 'api-sports-rugby',
      label: 'API-Rugby',
      dailyBudget: env.budgetApiSports,
      minGapMs: 250,
      configured: Boolean(env.apiSportsKey),
      docsUrl: 'https://dashboard.api-football.com',
    },
    { provider: 'tennis-archive', label: 'Tennis archive (Sackmann mirror)', dailyBudget: 0, minGapMs: 500, configured: true, docsUrl: 'https://github.com/Aneeshers/tennis-sackmann-archive' },
    {
      provider: 'thesportsdb',
      label: 'TheSportsDB',
      dailyBudget: env.budgetTheSportsDb,
      // Free key: about 30 requests per minute.
      minGapMs: 2_100,
      configured: true,
      docsUrl: 'https://www.thesportsdb.com/free_sports_api',
    },
    {
      provider: 'football-data-co-uk',
      label: 'Football-Data.co.uk archive',
      dailyBudget: 0,
      minGapMs: 500,
      configured: true,
      docsUrl: 'https://www.football-data.co.uk/data.php',
    },
    { provider: 'clubelo', label: 'ClubElo', dailyBudget: 0, minGapMs: 1_000, configured: true, docsUrl: 'http://clubelo.com/API' },
    {
      provider: 'open-meteo',
      label: 'Open-Meteo weather',
      dailyBudget: env.budgetOpenMeteo,
      minGapMs: 150,
      configured: true,
      docsUrl: 'https://open-meteo.com',
    },
    { provider: 'news-rss', label: 'Google News RSS', dailyBudget: 0, minGapMs: 1_000, configured: true },
    {
      provider: 'odds-api',
      label: 'The Odds API',
      dailyBudget: env.budgetOddsApi,
      minGapMs: 500,
      configured: Boolean(env.oddsApiKey),
      docsUrl: 'https://the-odds-api.com',
    },
    { provider: 'espn', label: 'ESPN (unofficial)', dailyBudget: 0, minGapMs: 500, configured: true },
    {
      provider: 'cricketdata',
      label: 'cricketdata.org',
      dailyBudget: env.budgetCricketData,
      minGapMs: 500,
      configured: Boolean(env.cricketDataKey),
      docsUrl: 'https://cricketdata.org',
    },
    { provider: 'cricsheet', label: 'Cricsheet archive', dailyBudget: 0, minGapMs: 500, configured: true },
    { provider: 'jolpica', label: 'Jolpica F1', dailyBudget: 0, minGapMs: 1_100, configured: true },
    { provider: 'openf1', label: 'OpenF1', dailyBudget: 0, minGapMs: 400, configured: true },
  ];
}

export function budgetFor(provider: ProviderKey): ProviderBudget {
  return providerBudgets().find((b) => b.provider === provider) ?? {
    provider,
    label: provider,
    dailyBudget: 0,
    minGapMs: 500,
    configured: true,
  };
}

export interface ProviderUsageToday {
  provider: ProviderKey;
  label: string;
  requests: number;
  errors: number;
  dailyBudget: number;
  configured: boolean;
}

/** Today's request counts for every provider, for the Today page and /api/live. */
export async function usageToday(now = new Date()): Promise<ProviderUsageToday[]> {
  const key = dayKey(now);
  const rows = await withDatabase(() => prisma.providerUsage.findMany({ where: { dayKey: key } }));
  const byProvider = new Map((rows.ok ? rows.data : []).map((row) => [row.provider, row]));
  return providerBudgets().map((budget) => ({
    provider: budget.provider,
    label: budget.label,
    requests: byProvider.get(budget.provider)?.requests ?? 0,
    errors: byProvider.get(budget.provider)?.errors ?? 0,
    dailyBudget: budget.dailyBudget,
    configured: budget.configured,
  }));
}

/** Requests still allowed today, or Infinity when the provider has no daily cap. */
export async function remainingToday(provider: ProviderKey, now = new Date()): Promise<number> {
  const budget = budgetFor(provider);
  if (budget.dailyBudget <= 0) return Number.POSITIVE_INFINITY;
  const row = await withDatabase(() =>
    prisma.providerUsage.findUnique({ where: { provider_dayKey: { provider, dayKey: dayKey(now) } } }),
  );
  const used = row.ok && row.data ? row.data.requests : 0;
  return Math.max(0, budget.dailyBudget - used);
}

/** Count one request (and optionally one error) against today's ledger. */
export async function recordUsage(provider: ProviderKey, failed = false, now = new Date()): Promise<void> {
  const key = dayKey(now);
  await withDatabase(() =>
    prisma.providerUsage.upsert({
      where: { provider_dayKey: { provider, dayKey: key } },
      create: { provider, dayKey: key, requests: 1, errors: failed ? 1 : 0 },
      update: { requests: { increment: 1 }, ...(failed ? { errors: { increment: 1 } } : {}) },
    }),
  );
}
