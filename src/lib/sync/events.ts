/**
 * Turning provider references into rows: competitions, events, stats,
 * lineups and injuries. Everything here is idempotent, so a sync can be
 * repeated safely and a second provider can enrich what the first created.
 */

import type { Competition, Event } from '@prisma/client';

import { resolveTeam } from '@/lib/entities/linking';
import { parseJson, prisma } from '@/lib/prisma';
import type {
  CompetitionRef,
  EventRef,
  EventStatsRef,
  InjuryRef,
  LineupRef,
  ProviderKey,
  SportsDataProvider,
} from '@/lib/providers/provider';
import { curatedFor, currentStartYear } from '@/lib/sports/competitions';
import type { SportKey } from '@/lib/sports/registry';
import { parseResult } from '@/lib/types';

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mergeIds(raw: string, provider: ProviderKey, externalId: string): string {
  const ids = parseJson<Record<string, string>>(raw, {});
  ids[provider] = externalId;
  return JSON.stringify(ids);
}

/** The provider's id for a row, from its providerIdsJson. */
export function providerIdOf(row: { providerIdsJson: string }, provider: ProviderKey): string | null {
  return parseJson<Record<string, string>>(row.providerIdsJson, {})[provider] ?? null;
}

/** A CompetitionRef for calling a provider about a stored competition. */
export function competitionRefFor(competition: Competition, provider: ProviderKey): CompetitionRef | null {
  const externalId = providerIdOf(competition, provider);
  if (!externalId) return null;
  return {
    externalId,
    name: competition.name,
    shortName: competition.shortName ?? undefined,
    country: competition.country ?? undefined,
    currentSeason: competition.currentSeason ?? undefined,
  };
}

/**
 * Find or create a competition from a provider's listing. Matched by the
 * provider id first, then by slug (country + name), so two providers that
 * spell a league the same way share one row.
 */
export async function upsertCompetition(provider: ProviderKey, sportKey: SportKey, ref: CompetitionRef, slugHint?: string): Promise<Competition> {
  const slug = slugHint ?? slugify(`${ref.country ?? ''} ${ref.name}`);
  const all = await prisma.competition.findMany({ where: { sportKey } });
  let match = all.find((c) => providerIdOf(c, provider) === ref.externalId) ?? all.find((c) => c.slug === slug) ?? null;
  if (!match) {
    match = await prisma.competition.create({
      data: {
        sportKey,
        slug,
        name: ref.name,
        shortName: ref.shortName,
        country: ref.country,
        type: ref.type ?? 'LEAGUE',
        currentSeason: ref.currentSeason,
        tier: ref.tier ?? 1,
        logoUrl: ref.logoUrl,
        providerIdsJson: JSON.stringify({ [provider]: ref.externalId }),
      },
    });
    return match;
  }
  const patch: Record<string, unknown> = {};
  const ids = mergeIds(match.providerIdsJson, provider, ref.externalId);
  if (ids !== match.providerIdsJson) patch.providerIdsJson = ids;
  if (!match.shortName && ref.shortName) patch.shortName = ref.shortName;
  if (!match.logoUrl && ref.logoUrl) patch.logoUrl = ref.logoUrl;
  if (ref.currentSeason && match.currentSeason !== ref.currentSeason) patch.currentSeason = ref.currentSeason;
  if (Object.keys(patch).length === 0) return match;
  return prisma.competition.update({ where: { id: match.id }, data: patch });
}

/**
 * Seed the curated competitions for a sport so every provider's id for the
 * same league lands on one row. Existing rows gain any ids they lack.
 */
export async function seedCuratedCompetitions(sportKey: SportKey, now = new Date()): Promise<number> {
  let created = 0;
  for (const curated of curatedFor(sportKey)) {
    const existing = await prisma.competition.findUnique({ where: { sportKey_slug: { sportKey, slug: curated.slug } } });
    if (!existing) {
      await prisma.competition.create({
        data: {
          sportKey,
          slug: curated.slug,
          name: curated.name,
          shortName: curated.shortName,
          country: curated.country,
          type: curated.type,
          tier: curated.tier,
          currentSeason: String(currentStartYear(now, curated.crossYear)),
          providerIdsJson: JSON.stringify(curated.ids),
        },
      });
      created += 1;
      continue;
    }
    const ids = parseJson<Record<string, string>>(existing.providerIdsJson, {});
    let changed = false;
    for (const [provider, id] of Object.entries(curated.ids)) {
      if (id && !ids[provider]) {
        ids[provider] = id;
        changed = true;
      }
    }
    if (changed) await prisma.competition.update({ where: { id: existing.id }, data: { providerIdsJson: JSON.stringify(ids) } });
  }
  return created;
}

const MATCH_WINDOW_MS = 36 * 3_600_000;

/**
 * Find or create the event a reference describes, then bring its status,
 * time and result up to date. Matching: the provider's id first, then the
 * natural key (competition, home, away, kickoff within 36 hours), which is
 * how a second provider's data lands on the same fixture.
 */
export async function upsertEvent(provider: ProviderKey, competition: Competition, ref: EventRef): Promise<Event | null> {
  const sportKey = competition.sportKey as SportKey;
  if (ref.entrants && ref.entrants.length > 0) return upsertRace(provider, competition, ref);
  const home = await resolveTeam(provider, ref.home, sportKey);
  const away = await resolveTeam(provider, ref.away, sportKey);
  // Two names that resolve to the same competitor mean the entity matcher has
  // merged two people, which is most likely with similar player names. The
  // event is unusable and a participant row would breach its unique key, so
  // skip it rather than lose the rest of the season to a failed transaction.
  if (home.id === away.id) return null;

  const candidates = await prisma.event.findMany({
    where: {
      competitionId: competition.id,
      homeTeamId: home.id,
      awayTeamId: away.id,
      startsAt: { gte: new Date(ref.startsAt.getTime() - MATCH_WINDOW_MS), lte: new Date(ref.startsAt.getTime() + MATCH_WINDOW_MS) },
    },
  });
  let event =
    candidates.find((c) => providerIdOf(c, provider) === ref.externalId) ??
    candidates.sort((a, b) => Math.abs(a.startsAt.getTime() - ref.startsAt.getTime()) - Math.abs(b.startsAt.getTime() - ref.startsAt.getTime()))[0] ??
    null;

  const venueId = ref.venue ? (await prisma.venue.findFirst({ where: { name: ref.venue.name } }))?.id ?? home.venueId : home.venueId;
  const resultJson = ref.result ? JSON.stringify(ref.result) : undefined;

  if (!event) {
    event = await prisma.event.create({
      data: {
        sportKey,
        competitionId: competition.id,
        season: ref.season,
        round: ref.round,
        stage: ref.stage,
        startsAt: ref.startsAt,
        status: ref.status,
        minute: ref.minute,
        venueId,
        homeTeamId: home.id,
        awayTeamId: away.id,
        format: ref.format,
        referee: ref.referee,
        resultJson: resultJson ?? '{}',
        providerIdsJson: JSON.stringify({ [provider]: ref.externalId }),
        lastSyncedAt: new Date(),
        participants: {
          create: [
            { teamId: home.id, side: 'HOME' },
            { teamId: away.id, side: 'AWAY' },
          ],
        },
      },
    });
    return event;
  }

  // Never let a provider without results downgrade a finished event, and
  // never let a stale "scheduled" overwrite a live or finished status.
  const rank: Record<string, number> = { CANCELLED: 4, POSTPONED: 3, FINISHED: 3, LIVE: 2, SCHEDULED: 1 };
  const keepStatus = (rank[event.status] ?? 0) > (rank[ref.status] ?? 0) && ref.status === 'SCHEDULED';
  const existingResult = parseResult(event.resultJson);
  const patch: Record<string, unknown> = { lastSyncedAt: new Date() };
  const ids = mergeIds(event.providerIdsJson, provider, ref.externalId);
  if (ids !== event.providerIdsJson) patch.providerIdsJson = ids;
  if (!keepStatus && event.status !== ref.status) patch.status = ref.status;
  if (ref.minute !== undefined && ref.minute !== event.minute) patch.minute = ref.minute;
  if (Math.abs(event.startsAt.getTime() - ref.startsAt.getTime()) > 60_000 && !keepStatus) patch.startsAt = ref.startsAt;
  if (ref.round && event.round !== ref.round) patch.round = ref.round;
  if (ref.referee && !event.referee) patch.referee = ref.referee;
  if (!event.venueId && venueId) patch.venueId = venueId;
  if (resultJson && (ref.status !== 'SCHEDULED' || existingResult.homeScore === undefined) && resultJson !== event.resultJson) {
    patch.resultJson = resultJson;
  }
  if (Object.keys(patch).length === 1) return event;
  return prisma.event.update({ where: { id: event.id }, data: patch });
}

/**
 * A multi-entrant event (a race): matched by the provider id, then by
 * competition, season and round. Entrants become participant rows with grid
 * and finishing positions; the winner is recorded in the result.
 */
async function upsertRace(provider: ProviderKey, competition: Competition, ref: EventRef): Promise<Event> {
  const sportKey = competition.sportKey as SportKey;
  const entrants = ref.entrants ?? [];
  const resolved = [];
  for (const entrant of entrants) resolved.push({ ...entrant, team: await resolveTeam(provider, entrant.team, sportKey) });
  const winner = resolved.find((e) => e.finishPosition === 1);
  const result = ref.result ?? {};
  const resultJson = JSON.stringify({ ...result, extra: { ...(result.extra ?? {}), ...(winner ? { winnerTeamId: winner.team.id, winnerName: winner.team.name } : {}) } });

  const candidates = await prisma.event.findMany({ where: { competitionId: competition.id, season: ref.season, round: ref.round ?? undefined } });
  let event = candidates.find((c) => providerIdOf(c, provider) === ref.externalId) ?? candidates[0] ?? null;
  let venueId: string | undefined;
  if (ref.venue?.name) {
    const venue = (await prisma.venue.findFirst({ where: { name: ref.venue.name } })) ?? (await prisma.venue.create({ data: { name: ref.venue.name, city: ref.venue.city, country: ref.venue.country, lat: ref.venue.lat, lon: ref.venue.lon } }));
    venueId = venue.id;
  }
  if (!event) {
    event = await prisma.event.create({
      data: {
        sportKey,
        competitionId: competition.id,
        season: ref.season,
        round: ref.round,
        stage: ref.stage,
        startsAt: ref.startsAt,
        status: ref.status,
        venueId,
        format: ref.format,
        resultJson,
        providerIdsJson: JSON.stringify({ [provider]: ref.externalId }),
        lastSyncedAt: new Date(),
      },
    });
  } else {
    const rank: Record<string, number> = { CANCELLED: 4, POSTPONED: 3, FINISHED: 3, LIVE: 2, SCHEDULED: 1 };
    const keepStatus = (rank[event.status] ?? 0) > (rank[ref.status] ?? 0) && ref.status === 'SCHEDULED';
    event = await prisma.event.update({
      where: { id: event.id },
      data: {
        providerIdsJson: mergeIds(event.providerIdsJson, provider, ref.externalId),
        ...(keepStatus ? {} : { status: ref.status, startsAt: ref.startsAt }),
        ...(winner || event.resultJson === '{}' ? { resultJson } : {}),
        ...(venueId && !event.venueId ? { venueId } : {}),
        lastSyncedAt: new Date(),
      },
    });
  }
  for (const entrant of resolved) {
    await prisma.eventParticipant.upsert({
      where: { eventId_teamId: { eventId: event.id, teamId: entrant.team.id } },
      create: { eventId: event.id, teamId: entrant.team.id, side: 'ENTRANT', gridPosition: entrant.gridPosition, finishPosition: entrant.finishPosition, score: entrant.score, statusNote: entrant.statusNote },
      update: { gridPosition: entrant.gridPosition, finishPosition: entrant.finishPosition, score: entrant.score, statusNote: entrant.statusNote },
    });
  }
  // The entry list is authoritative: a driver dropped from it (a reserve who went home) leaves the race.
  if (resolved.length > 0) {
    await prisma.eventParticipant.deleteMany({ where: { eventId: event.id, side: 'ENTRANT', teamId: { notIn: resolved.map((r) => r.team.id) } } });
  }
  return event;
}

export async function upsertEventStats(provider: ProviderKey, event: Event, refs: EventStatsRef[]): Promise<number> {
  let written = 0;
  for (const ref of refs) {
    const alias = await prisma.teamAlias.findUnique({ where: { provider_externalId: { provider, externalId: ref.teamExternalId } } });
    if (!alias) continue;
    await prisma.eventStats.upsert({
      where: { eventId_teamId: { eventId: event.id, teamId: alias.teamId } },
      create: { eventId: event.id, teamId: alias.teamId, statsJson: JSON.stringify(ref.stats), source: provider },
      update: { statsJson: JSON.stringify(ref.stats), source: provider },
    });
    written += 1;
  }
  return written;
}

export async function upsertLineups(provider: ProviderKey, event: Event, refs: LineupRef[]): Promise<number> {
  let written = 0;
  for (const ref of refs) {
    const alias = await prisma.teamAlias.findUnique({ where: { provider_externalId: { provider, externalId: ref.teamExternalId } } });
    if (!alias) continue;
    await prisma.lineup.upsert({
      where: { eventId_teamId: { eventId: event.id, teamId: alias.teamId } },
      create: {
        eventId: event.id,
        teamId: alias.teamId,
        formation: ref.formation,
        coach: ref.coach,
        startersJson: JSON.stringify(ref.starters),
        benchJson: JSON.stringify(ref.bench),
        confirmed: ref.confirmed,
        source: provider,
      },
      update: {
        formation: ref.formation,
        coach: ref.coach,
        startersJson: JSON.stringify(ref.starters),
        benchJson: JSON.stringify(ref.bench),
        confirmed: ref.confirmed,
        source: provider,
      },
    });
    written += 1;
  }
  return written;
}

/**
 * Replace a team's open injuries with the provider's current list. Rows
 * that disappeared are resolved rather than deleted, so history survives.
 */
export async function syncInjuries(provider: ProviderKey, refs: InjuryRef[], teamIds: Set<string>): Promise<number> {
  const now = new Date();
  const byTeam = new Map<string, InjuryRef[]>();
  for (const ref of refs) {
    const alias = await prisma.teamAlias.findUnique({ where: { provider_externalId: { provider, externalId: ref.teamExternalId } } });
    if (!alias) continue;
    const list = byTeam.get(alias.teamId) ?? [];
    list.push(ref);
    byTeam.set(alias.teamId, list);
  }
  let written = 0;
  for (const teamId of teamIds) {
    const current = byTeam.get(teamId) ?? [];
    const open = await prisma.injury.findMany({ where: { teamId, resolvedAt: null } });
    const stillOut = new Set(current.map((ref) => ref.playerName.toLowerCase()));
    for (const row of open) {
      if (!stillOut.has(row.playerName.toLowerCase())) {
        await prisma.injury.update({ where: { id: row.id }, data: { resolvedAt: now } });
      }
    }
    const openNames = new Set(open.map((row) => row.playerName.toLowerCase()));
    for (const ref of current) {
      if (openNames.has(ref.playerName.toLowerCase())) {
        await prisma.injury.updateMany({
          where: { teamId, playerName: ref.playerName, resolvedAt: null },
          data: { status: ref.status, type: ref.type, reason: ref.reason, expectedReturn: ref.expectedReturn },
        });
        continue;
      }
      await prisma.injury.create({
        data: {
          teamId,
          playerName: ref.playerName,
          type: ref.type,
          status: ref.status,
          reason: ref.reason,
          source: provider,
          reportedAt: ref.reportedAt ?? now,
          expectedReturn: ref.expectedReturn,
        },
      });
      written += 1;
    }
  }
  return written;
}

/** Events lacking per-team stats among the finished ones in a window. */
export async function eventsMissingStats(competitionId: string, since: Date): Promise<Event[]> {
  const events = await prisma.event.findMany({
    where: { competitionId, status: 'FINISHED', startsAt: { gte: since } },
    include: { stats: { select: { id: true } } },
    orderBy: { startsAt: 'desc' },
  });
  return events.filter((event) => event.stats.length < 2);
}

/** Build the EventRef a provider expects for one of our stored events. */
export function eventRefFor(event: Event & { homeTeam: { providerIdsJson: string; name: string } | null; awayTeam: { providerIdsJson: string; name: string } | null }, provider: SportsDataProvider, competition: Competition): EventRef | null {
  const externalId = providerIdOf(event, provider.key);
  const competitionExternalId = providerIdOf(competition, provider.key);
  const homeId = event.homeTeam ? providerIdOf(event.homeTeam, provider.key) : null;
  const awayId = event.awayTeam ? providerIdOf(event.awayTeam, provider.key) : null;
  if (!externalId || !competitionExternalId || !homeId || !awayId || !event.homeTeam || !event.awayTeam) return null;
  return {
    externalId,
    competitionExternalId,
    season: event.season,
    startsAt: event.startsAt,
    status: event.status as EventRef['status'],
    home: { externalId: homeId, name: event.homeTeam.name },
    away: { externalId: awayId, name: event.awayTeam.name },
  };
}
