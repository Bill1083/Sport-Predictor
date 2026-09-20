/**
 * Cross-provider entity linking.
 *
 * Every provider has its own ids and its own spelling of a team's name
 * ("Man City", "Manchester City FC", "Manchester City"). The alias table
 * remembers each provider's id once it is matched, and a normalised-name
 * comparison does the first match. Anything ambiguous is created as a new
 * team rather than guessed, and shows up in Settings as unmatched so it can
 * be merged by hand.
 */

import type { Team, Venue } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import type { ProviderKey, TeamRef, VenueRef } from '@/lib/providers/provider';

const STOP_WORDS = new Set([
  'fc',
  'afc',
  'cf',
  'sc',
  'ac',
  'as',
  'ss',
  'us',
  'sv',
  'bk',
  'if',
  'fk',
  'cd',
  'rc',
  'club',
  'de',
  'the',
  'football',
  'calcio',
  'women',
  'rfc',
  'rlfc',
  'cc',
  'united',
  'utd',
]);

const ALIASES: Record<string, string> = {
  'man city': 'manchester city',
  'man utd': 'manchester',
  'man united': 'manchester',
  'manchester united': 'manchester',
  spurs: 'tottenham hotspur',
  'wolverhampton wanderers': 'wolves',
  wolverhampton: 'wolves',
  'brighton hove albion': 'brighton',
  'brighton and hove albion': 'brighton',
  'west ham united': 'west ham',
  'newcastle united': 'newcastle',
  'leeds united': 'leeds',
  'sheffield united': 'sheffield utd',
  'nottingham forest': "nott'm forest",
  "nott m forest": "nott'm forest",
  'nottm forest': "nott'm forest",
  'inter milan': 'inter',
  internazionale: 'inter',
  'fc internazionale milano': 'inter',
  'paris saint germain': 'psg',
  'paris saint-germain': 'psg',
  'bayern munchen': 'bayern munich',
  'fc bayern munchen': 'bayern munich',
  'borussia monchengladbach': 'gladbach',
  'atletico de madrid': 'atletico madrid',
  'club atletico de madrid': 'atletico madrid',
  'real sociedad de futbol': 'real sociedad',
  'athletic club': 'athletic bilbao',
};

/** Lowercase, strip accents and punctuation, drop club suffixes, collapse spaces. */
export function normaliseName(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const aliased = ALIASES[base] ?? base;
  const words = aliased.split(' ').filter((word) => word && !STOP_WORDS.has(word));
  return (words.length > 0 ? words.join(' ') : aliased).trim();
}

/** Jaro-Winkler similarity, 0..1; used only to flag likely duplicates. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j += 1) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, a.length, b.length); i += 1) {
    if (a[i] === b[i]) prefix += 1;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

async function upsertVenue(ref: VenueRef | undefined, existingId: string | null): Promise<Venue | null> {
  if (!ref?.name) return null;
  if (existingId) {
    const current = await prisma.venue.findUnique({ where: { id: existingId } });
    if (current && current.name === ref.name) {
      if ((ref.lat !== undefined && current.lat === null) || (ref.capacity !== undefined && current.capacity === null)) {
        return prisma.venue.update({
          where: { id: current.id },
          data: {
            city: current.city ?? ref.city,
            country: current.country ?? ref.country,
            lat: current.lat ?? ref.lat,
            lon: current.lon ?? ref.lon,
            capacity: current.capacity ?? ref.capacity,
          },
        });
      }
      return current;
    }
  }
  const found = await prisma.venue.findFirst({ where: { name: ref.name } });
  if (found) return found;
  return prisma.venue.create({
    data: { name: ref.name, city: ref.city, country: ref.country, lat: ref.lat, lon: ref.lon, capacity: ref.capacity },
  });
}

function mergeProviderIds(raw: string, provider: ProviderKey, externalId: string): string {
  let ids: Record<string, string> = {};
  try {
    ids = JSON.parse(raw) as Record<string, string>;
  } catch {
    ids = {};
  }
  ids[provider] = externalId;
  return JSON.stringify(ids);
}

/**
 * Find or create the team a provider reference points at.
 *
 *   1. alias (provider, externalId)      exact, remembered from a past sync
 *   2. alias (any provider, same name)   another provider already named it
 *   3. team with the same normalised name in the same sport
 *   4. create
 *
 * Missing details (crest, venue, code) are filled in from the reference, so
 * a richer provider can improve a row a poorer one created.
 */
export async function resolveTeam(provider: ProviderKey, ref: TeamRef, sportKey: string): Promise<Team> {
  const alias = await prisma.teamAlias.findUnique({
    where: { provider_externalId: { provider, externalId: ref.externalId } },
    include: { team: true },
  });
  let team: Team | null = alias?.team ?? null;

  if (!team) {
    const norm = normaliseName(ref.name);
    const byAlias = await prisma.teamAlias.findFirst({
      where: { name: norm, team: { sportKey, kind: ref.kind ?? 'TEAM' } },
      include: { team: true },
    });
    team = byAlias?.team ?? null;
    if (!team) {
      const candidates = await prisma.team.findMany({ where: { sportKey, kind: ref.kind ?? 'TEAM' } });
      team = candidates.find((candidate) => normaliseName(candidate.name) === norm) ?? null;
      if (!team && ref.shortName) {
        const short = normaliseName(ref.shortName);
        team = candidates.find((candidate) => normaliseName(candidate.shortName ?? '') === short && short.length > 3) ?? null;
      }
    }
    if (!team) {
      const venue = await upsertVenue(ref.venue, null);
      team = await prisma.team.create({
        data: {
          sportKey,
          kind: ref.kind ?? 'TEAM',
          name: ref.name,
          shortName: ref.shortName,
          code: ref.code,
          country: ref.country,
          crestUrl: ref.crestUrl,
          founded: ref.founded,
          venueId: venue?.id,
          providerIdsJson: JSON.stringify({ [provider]: ref.externalId }),
        },
      });
    }
    await prisma.teamAlias.create({
      data: { provider, externalId: ref.externalId, name: norm, teamId: team.id },
    });
  }

  // Fill gaps the reference can close.
  const venue = !team.venueId || ref.venue ? await upsertVenue(ref.venue, team.venueId) : null;
  const patch: Record<string, unknown> = {};
  if (!team.shortName && ref.shortName) patch.shortName = ref.shortName;
  if (!team.code && ref.code) patch.code = ref.code;
  if (!team.country && ref.country) patch.country = ref.country;
  if (!team.crestUrl && ref.crestUrl) patch.crestUrl = ref.crestUrl;
  if (!team.founded && ref.founded) patch.founded = ref.founded;
  if (venue && team.venueId !== venue.id) patch.venueId = venue.id;
  const ids = mergeProviderIds(team.providerIdsJson, provider, ref.externalId);
  if (ids !== team.providerIdsJson) patch.providerIdsJson = ids;
  if (Object.keys(patch).length > 0) {
    team = await prisma.team.update({ where: { id: team.id }, data: patch });
  }
  return team;
}

/** Teams whose only alias comes from a single provider: likely duplicates to review. */
export async function unmatchedTeams(sportKey?: string): Promise<{ team: Team; aliases: string[]; similarTo: { id: string; name: string; score: number } | null }[]> {
  const teams = await prisma.team.findMany({ where: sportKey ? { sportKey } : {}, include: { aliases: true } });
  const out: { team: Team; aliases: string[]; similarTo: { id: string; name: string; score: number } | null }[] = [];
  for (const team of teams) {
    const providers = new Set(team.aliases.map((a) => a.provider));
    if (providers.size > 1) continue;
    const norm = normaliseName(team.name);
    let best: { id: string; name: string; score: number } | null = null;
    for (const other of teams) {
      if (other.id === team.id || other.sportKey !== team.sportKey) continue;
      const score = similarity(norm, normaliseName(other.name));
      if (score >= 0.86 && (!best || score > best.score)) best = { id: other.id, name: other.name, score };
    }
    if (best) out.push({ team, aliases: team.aliases.map((a) => `${a.provider}:${a.externalId ?? a.name}`), similarTo: best });
  }
  return out;
}

/** Merge `fromId` into `intoId`: aliases, events, stats and ratings move over, then the duplicate is deleted. */
export async function mergeTeams(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  await prisma.$transaction(async (tx) => {
    await tx.teamAlias.updateMany({ where: { teamId: fromId }, data: { teamId: intoId } });
    await tx.event.updateMany({ where: { homeTeamId: fromId }, data: { homeTeamId: intoId } });
    await tx.event.updateMany({ where: { awayTeamId: fromId }, data: { awayTeamId: intoId } });
    await tx.eventParticipant.updateMany({ where: { teamId: fromId }, data: { teamId: intoId } });
    await tx.eventStats.updateMany({ where: { teamId: fromId }, data: { teamId: intoId } });
    await tx.lineup.updateMany({ where: { teamId: fromId }, data: { teamId: intoId } });
    await tx.injury.updateMany({ where: { teamId: fromId }, data: { teamId: intoId } });
    await tx.rating.updateMany({ where: { teamId: fromId }, data: { teamId: intoId } });
    await tx.player.updateMany({ where: { teamId: fromId }, data: { teamId: intoId } });
    await tx.newsItem.updateMany({ where: { teamId: fromId }, data: { teamId: intoId } });
    await tx.team.delete({ where: { id: fromId } });
  });
}
