/**
 * The sync jobs: catalogue, fixtures, results, context, backfill.
 *
 * Each runs per sport over the followed competitions, picks providers by
 * capability, and stops cleanly when a provider's daily budget is spent
 * (the job reports PARTIAL and the scheduler tries again next time).
 */

import type { Competition } from '@prisma/client';

import { normaliseName, resolveTeam } from '@/lib/entities/linking';
import { env } from '@/lib/env';
import { registerJob } from '@/lib/jobs/registry';
import type { JobHandler, JobProgress, JobResult, JobScope } from '@/lib/jobs/types';
import { parseJson, prisma } from '@/lib/prisma';
import { pruneCache } from '@/lib/providers/http';
import { forecastAt } from '@/lib/providers/open-meteo';
import { BudgetExhaustedError, ProviderError, type SportsDataProvider } from '@/lib/providers/provider';
import { providerByKey, providersFor } from '@/lib/providers/registry';
import { TheSportsDbProvider } from '@/lib/providers/thesportsdb';
import { getSettingsForSports } from '@/lib/settings';
import { isSportKey, type SportKey } from '@/lib/sports/registry';
import {
  competitionRefFor,
  eventRefFor,
  eventsMissingStats,
  seedCuratedCompetitions,
  syncInjuries,
  upsertCompetition,
  upsertEvent,
  upsertEventStats,
  upsertLineups,
} from '@/lib/sync/events';
import type { Weather } from '@/lib/types';

async function enabledSports(scope: JobScope): Promise<SportKey[]> {
  if (scope.sportKey) return isSportKey(scope.sportKey) ? [scope.sportKey] : [];
  const rows = await prisma.sport.findMany({ where: { enabled: true } });
  return rows.map((row) => row.key).filter(isSportKey);
}

async function followedCompetitions(sportKey: SportKey, scope: JobScope): Promise<Competition[]> {
  return prisma.competition.findMany({
    where: { sportKey, followed: true, ...(scope.competitionId ? { id: scope.competitionId } : {}) },
    orderBy: [{ tier: 'asc' }, { name: 'asc' }],
  });
}

interface Tally {
  ok: number;
  failed: number;
  budget: boolean;
  notes: string[];
}

function outcome(tally: Tally, what: string): JobResult {
  const status = tally.budget || tally.failed > 0 ? (tally.ok > 0 ? 'PARTIAL' : 'FAILED') : 'OK';
  const parts = [`${tally.ok} ${what}`];
  if (tally.failed > 0) parts.push(`${tally.failed} failed`);
  if (tally.budget) parts.push('budget exhausted, resumes tomorrow');
  return { status: tally.ok === 0 && tally.failed === 0 && !tally.budget ? 'OK' : status, message: parts.join(', '), metrics: { ...tally } };
}

/** Run `fn` for one provider call, translating provider failures into the tally. */
async function attempt(tally: Tally, progress: JobProgress, label: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn();
    tally.ok += 1;
    return true;
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      tally.budget = true;
      progress.log(`${label}: ${error.message}`);
      return false;
    }
    tally.failed += 1;
    const message = error instanceof Error ? error.message : String(error);
    progress.log(`${label}: ${message}`);
    if (!(error instanceof ProviderError)) console.error(`[scoresage] ${label} failed:`, message);
    return true;
  }
}

// ---------------------------------------------------------------------------
// sync:catalogue - competitions and teams a provider offers
// ---------------------------------------------------------------------------

const catalogue: JobHandler = {
  kind: 'SYNC',
  label: 'Catalogue sync',
  defaultIntervalMinutes: 7 * 24 * 60,
  perSport: true,
  async run(scope, progress) {
    const tally: Tally = { ok: 0, failed: 0, budget: false, notes: [] };
    const sports = await enabledSports(scope);
    const settings = await getSettingsForSports(sports);
    await progress.phase('listing competitions', sports.length);
    for (const sportKey of sports) {
      if (!env.mockSports) {
        const seeded = await seedCuratedCompetitions(sportKey);
        if (seeded > 0) progress.log(`${sportKey}: seeded ${seeded} curated competitions`);
      }
      const providers = providersFor(sportKey, 'competitions', settings.get(sportKey)?.providerOrder);
      for (const provider of providers) {
        const proceed = await attempt(tally, progress, `${provider.key} competitions`, async () => {
          const refs = await provider.listCompetitions(sportKey);
          for (const ref of refs) await upsertCompetition(provider.key, sportKey, ref);
          progress.log(`${provider.key}: ${refs.length} competitions for ${sportKey}`);
        });
        if (!proceed) break;
      }
      await progress.tick();
    }
    // Teams and crests for the followed competitions.
    const followed = await prisma.competition.findMany({ where: { sportKey: { in: sports }, followed: true } });
    await progress.phase('teams and crests', followed.length);
    for (const competition of followed) {
      const sportKey = competition.sportKey as SportKey;
      for (const provider of providersFor(sportKey, 'teams', settings.get(sportKey)?.providerOrder)) {
        const ref = competitionRefFor(competition, provider.key);
        if (!ref) continue;
        const proceed = await attempt(tally, progress, `${provider.key} teams ${competition.name}`, async () => {
          const { resolveTeam } = await import('@/lib/entities/linking');
          const teams = await provider.listTeams(ref, competition.currentSeason ?? ref.currentSeason ?? '');
          for (const team of teams) await resolveTeam(provider.key, team, sportKey);
        });
        if (!proceed) break;
      }
      await progress.tick();
    }
    // Crests and stadiums for teams no provider gave one, via TheSportsDB by name.
    if (!env.mockSports) {
      const tsdb = providerByKey('thesportsdb');
      const bare = await prisma.team.findMany({
        where: { sportKey: { in: sports }, crestUrl: null, OR: [{ homeEvents: { some: { competition: { followed: true } } } }, { awayEvents: { some: { competition: { followed: true } } } }] },
        take: 40,
      });
      if (tsdb instanceof TheSportsDbProvider && bare.length > 0) {
        await progress.phase('crests from TheSportsDB', bare.length);
        for (const team of bare) {
          const proceed = await attempt(tally, progress, `thesportsdb crest ${team.name}`, async () => {
            const found = await tsdb.findTeamByName(team.name);
            if (found && normaliseName(found.name) === normaliseName(team.name)) await resolveTeam('thesportsdb', found, team.sportKey as SportKey);
          });
          await progress.tick();
          if (!proceed) break;
        }
      }
    }
    const pruned = await pruneCache();
    if (pruned > 0) progress.log(`pruned ${pruned} expired cache rows`);
    return outcome(tally, 'provider calls');
  },
};

// ---------------------------------------------------------------------------
// sync:fixtures - the coming three weeks, plus recent results
// ---------------------------------------------------------------------------

const SEASON_LOOKBACK_DAYS = 400;
const FIXTURE_HORIZON_DAYS = 21;

type WindowFor = (competition: Competition) => { from: Date; to: Date };

async function syncWindow(scope: JobScope, progress: JobProgress, windowFor: WindowFor, capability: 'fixtures' | 'results'): Promise<JobResult> {
  const tally: Tally = { ok: 0, failed: 0, budget: false, notes: [] };
  const sports = await enabledSports(scope);
  const settings = await getSettingsForSports(sports);
  let events = 0;
  for (const sportKey of sports) {
    const competitions = await followedCompetitions(sportKey, scope);
    await progress.phase(`${capability} for ${sportKey}`, competitions.length);
    for (const competition of competitions) {
      const { from, to } = windowFor(competition);
      const providers = providersFor(sportKey, capability, settings.get(sportKey)?.providerOrder);
      const provider = providers.find((p) => competitionRefFor(competition, p.key)) ?? null;
      if (!provider) {
        progress.log(`${competition.name}: no configured provider knows this competition`);
        await progress.tick();
        continue;
      }
      const ref = competitionRefFor(competition, provider.key) as NonNullable<ReturnType<typeof competitionRefFor>>;
      const season = competition.currentSeason ?? ref.currentSeason ?? String(new Date().getUTCFullYear());
      const proceed = await attempt(tally, progress, `${provider.key} ${competition.name}`, async () => {
        const refs = await provider.listEvents(ref, season, { from, to });
        for (const eventRef of refs) {
          await upsertEvent(provider.key, competition, eventRef);
          events += 1;
        }
        await prisma.competition.update({ where: { id: competition.id }, data: { lastSyncedAt: new Date() } });
        progress.log(`${competition.name}: ${refs.length} events from ${provider.key}`);
      });
      await progress.tick();
      if (!proceed) break;
    }
  }
  const result = outcome(tally, 'competitions synced');
  result.metrics = { ...result.metrics, events };
  if (result.status === 'OK') result.message = `${events} events across ${tally.ok} competition${tally.ok === 1 ? '' : 's'}`;
  return result;
}

const fixtures: JobHandler = {
  kind: 'SYNC',
  label: 'Fixture sync',
  defaultIntervalMinutes: 24 * 60,
  perSport: true,
  async run(scope, progress) {
    const now = Date.now();
    // The whole current season plus three weeks ahead. Providers serve a
    // season in one request whatever the date range, so this costs no more
    // than a narrow window and keeps the table and form guide complete.
    return syncWindow(
      scope,
      progress,
      () => ({ from: new Date(now - SEASON_LOOKBACK_DAYS * 86_400_000), to: new Date(now + FIXTURE_HORIZON_DAYS * 86_400_000) }),
      'fixtures',
    );
  },
};

// ---------------------------------------------------------------------------
// sync:results - live scores and final results, then stats for finished games
// ---------------------------------------------------------------------------

const results: JobHandler = {
  kind: 'SYNC',
  label: 'Results sync',
  defaultIntervalMinutes: 15,
  perSport: true,
  async run(scope, progress) {
    const now = Date.now();
    // Only worth calling anyone if something is in play or recently finished.
    const pending = await prisma.event.count({
      where: {
        ...(scope.sportKey ? { sportKey: scope.sportKey } : {}),
        status: { in: ['SCHEDULED', 'LIVE'] },
        startsAt: { gte: new Date(now - 6 * 3_600_000), lte: new Date(now) },
      },
    });
    const missing = await prisma.event.count({
      where: {
        ...(scope.sportKey ? { sportKey: scope.sportKey } : {}),
        status: 'FINISHED',
        startsAt: { gte: new Date(now - 3 * 86_400_000) },
        stats: { none: {} },
      },
    });
    if (pending === 0 && missing === 0) return { status: 'OK', message: 'nothing in play', metrics: { pending, missing } };

    const window = await syncWindow(scope, progress, () => ({ from: new Date(now - 3 * 86_400_000), to: new Date(now + 3 * 3_600_000) }), 'results');
    if (window.status === 'FAILED') return window;

    // Per-match statistics for finished events that lack them.
    const tally: Tally = { ok: 0, failed: 0, budget: false, notes: [] };
    const sports = await enabledSports(scope);
    const settings = await getSettingsForSports(sports);
    let stats = 0;
    for (const sportKey of sports) {
      const providers = providersFor(sportKey, 'eventStats', settings.get(sportKey)?.providerOrder);
      if (providers.length === 0) continue;
      for (const competition of await followedCompetitions(sportKey, scope)) {
        const provider = providers.find((p) => competitionRefFor(competition, p.key)) as SportsDataProvider | undefined;
        if (!provider?.getEventStats) continue;
        const events = await prisma.event.findMany({
          where: { competitionId: competition.id, status: 'FINISHED', startsAt: { gte: new Date(now - 3 * 86_400_000) }, stats: { none: {} } },
          include: { homeTeam: true, awayTeam: true },
          take: 40,
        });
        await progress.phase(`stats for ${competition.name}`, events.length);
        for (const event of events) {
          const ref = eventRefFor(event, provider, competition);
          if (!ref) {
            await progress.tick();
            continue;
          }
          const proceed = await attempt(tally, progress, `${provider.key} stats ${ref.externalId}`, async () => {
            stats += await upsertEventStats(provider.key, event, await provider.getEventStats!(ref));
          });
          await progress.tick();
          if (!proceed) break;
        }
        if (tally.budget) break;
      }
    }
    const result = outcome(tally, 'stat fetches');
    return {
      status: window.status === 'PARTIAL' || result.status === 'PARTIAL' ? 'PARTIAL' : result.status,
      message: `${window.message}; ${stats} stat rows written`,
      metrics: { ...window.metrics, stats, ...result.metrics },
    };
  },
};

// ---------------------------------------------------------------------------
// sync:context - injuries and lineups ahead of kickoff
// ---------------------------------------------------------------------------

const context: JobHandler = {
  kind: 'SYNC',
  label: 'Context sync',
  defaultIntervalMinutes: 60,
  perSport: true,
  async run(scope, progress) {
    const tally: Tally = { ok: 0, failed: 0, budget: false, notes: [] };
    const now = Date.now();
    const sports = await enabledSports(scope);
    const settings = await getSettingsForSports(sports);
    let injuries = 0;
    let lineups = 0;
    let weather = 0;
    for (const sportKey of sports) {
      const sportSettings = settings.get(sportKey);
      const competitions = await followedCompetitions(sportKey, scope);
      const horizon = new Date(now + (sportSettings?.contextHoursBefore ?? 24) * 3_600_000);
      await progress.phase(`context for ${sportKey}`, competitions.length);
      for (const competition of competitions) {
        const upcoming = await prisma.event.count({ where: { competitionId: competition.id, status: 'SCHEDULED', startsAt: { gte: new Date(now), lte: horizon } } });
        if (upcoming === 0) {
          await progress.tick();
          continue;
        }
        const injuryProvider = providersFor(sportKey, 'injuries', sportSettings?.providerOrder).find((p) => p.getInjuries && competitionRefFor(competition, p.key));
        if (injuryProvider) {
          const ref = competitionRefFor(competition, injuryProvider.key)!;
          const proceed = await attempt(tally, progress, `${injuryProvider.key} injuries ${competition.name}`, async () => {
            const refs = await injuryProvider.getInjuries!(ref, competition.currentSeason ?? '');
            const teams = await prisma.event.findMany({
              where: { competitionId: competition.id, season: competition.currentSeason ?? undefined },
              select: { homeTeamId: true, awayTeamId: true },
              distinct: ['homeTeamId', 'awayTeamId'],
            });
            const teamIds = new Set<string>();
            for (const row of teams) {
              if (row.homeTeamId) teamIds.add(row.homeTeamId);
              if (row.awayTeamId) teamIds.add(row.awayTeamId);
            }
            injuries += await syncInjuries(injuryProvider.key, refs, teamIds);
          });
          if (!proceed) break;
        }
        const lineupProvider = providersFor(sportKey, 'lineups', sportSettings?.providerOrder).find((p) => p.getLineups && competitionRefFor(competition, p.key));
        if (lineupProvider) {
          const soon = new Date(now + (sportSettings?.lineupMinutesBefore ?? 90) * 60_000);
          const events = await prisma.event.findMany({
            where: { competitionId: competition.id, status: { in: ['SCHEDULED', 'LIVE'] }, startsAt: { lte: soon, gte: new Date(now - 2 * 3_600_000) }, lineups: { none: { confirmed: true } } },
            include: { homeTeam: true, awayTeam: true },
          });
          for (const event of events) {
            const ref = eventRefFor(event, lineupProvider, competition);
            if (!ref) continue;
            const proceed = await attempt(tally, progress, `${lineupProvider.key} lineups ${ref.externalId}`, async () => {
              lineups += await upsertLineups(lineupProvider.key, event, await lineupProvider.getLineups!(ref));
            });
            if (!proceed) break;
          }
        }
        await progress.tick();
        if (tally.budget) break;
      }
      // Weather at the venue for outdoor sports, refreshed every six hours.
      if (sportSettings?.weather !== false && !INDOOR_SPORTS.has(sportKey)) {
        const events = await prisma.event.findMany({
          where: { sportKey, status: 'SCHEDULED', startsAt: { gte: new Date(now), lte: horizon }, competition: { followed: true } },
          include: { venue: true, homeTeam: { include: { venue: true } } },
        });
        for (const event of events) {
          const venue = event.venue ?? event.homeTeam?.venue ?? null;
          if (!venue || venue.lat === null || venue.lon === null || venue.indoor) continue;
          const current = parseJson<Weather | null>(event.weatherJson, null);
          if (current?.fetchedAt && now - Date.parse(current.fetchedAt) < 6 * 3_600_000) continue;
          const forecast = await forecastAt(venue.lat, venue.lon, event.startsAt);
          if (forecast) {
            await prisma.event.update({ where: { id: event.id }, data: { weatherJson: JSON.stringify(forecast) } });
            weather += 1;
          }
        }
      }
    }
    const result = outcome(tally, 'context calls');
    result.message = `${injuries} injuries, ${lineups} lineups, ${weather} forecasts (${result.message})`;
    return result;
  },
};

const INDOOR_SPORTS = new Set(['basketball', 'ice_hockey', 'tennis']);

// ---------------------------------------------------------------------------
// backfill - past seasons for ratings and backtests (manual)
// ---------------------------------------------------------------------------

const backfill: JobHandler = {
  kind: 'BACKFILL',
  label: 'History backfill',
  defaultIntervalMinutes: null,
  perSport: true,
  async run(scope, progress) {
    const tally: Tally = { ok: 0, failed: 0, budget: false, notes: [] };
    const sports = await enabledSports(scope);
    const settings = await getSettingsForSports(sports);
    const requested = Array.isArray(scope.options?.seasons) ? (scope.options?.seasons as string[]) : null;
    const seasonsBack = typeof scope.options?.seasonsBack === 'number' ? (scope.options.seasonsBack as number) : 3;
    let events = 0;
    let stats = 0;
    for (const sportKey of sports) {
      const competitions = await followedCompetitions(sportKey, scope);
      for (const competition of competitions) {
        const provider = providersFor(sportKey, 'history', settings.get(sportKey)?.providerOrder).find((p) => p.listHistory && competitionRefFor(competition, p.key));
        if (!provider) {
          progress.log(`${competition.name}: no history provider configured`);
          continue;
        }
        const ref = competitionRefFor(competition, provider.key)!;
        const current = Number((competition.currentSeason ?? String(new Date().getUTCFullYear())).slice(0, 4));
        const seasons = requested ?? Array.from({ length: seasonsBack }, (_, i) => String(current - 1 - i));
        await progress.phase(`history for ${competition.name}`, seasons.length);
        for (const season of seasons) {
          const proceed = await attempt(tally, progress, `${provider.key} ${competition.name} ${season}`, async () => {
            const refs = await provider.listHistory!(ref, [season]);
            for (const eventRef of refs) {
              const event = await upsertEvent(provider.key, competition, eventRef);
              events += 1;
              if (provider.getEventStats && scope.options?.withStats !== false) {
                const existing = await prisma.eventStats.count({ where: { eventId: event.id } });
                if (existing < 2) stats += await upsertEventStats(provider.key, event, await provider.getEventStats(eventRef));
              }
            }
            progress.log(`${competition.name} ${season}: ${refs.length} events`);
          });
          await progress.tick();
          if (!proceed) break;
        }
        if (tally.budget) break;
      }
    }
    const result = outcome(tally, 'seasons');
    result.message = `${events} events, ${stats} stat rows (${result.message})`;
    return result;
  },
};

registerJob('sync:catalogue', catalogue);
registerJob('sync:fixtures', fixtures);
registerJob('sync:results', results);
registerJob('sync:context', context);
registerJob('backfill', backfill);

export const SYNC_JOBS = ['sync:catalogue', 'sync:fixtures', 'sync:results', 'sync:context', 'backfill'] as const;

/** Used by eventsMissingStats callers elsewhere; re-exported for convenience. */
export { eventsMissingStats };
