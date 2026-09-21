/**
 * Naming a favourite when the models cannot separate two competitors, and
 * being honest about how much is behind the number.
 *
 * A sport with no draw always has a winner, so a page that reports fifty-fifty
 * has told the reader nothing. This breaks the tie with a fixed cascade of
 * real signals, and says which one decided it. The nudge applied is small on
 * purpose: it names a side without inventing confidence.
 *
 * Nothing here is random. The same two competitors always produce the same
 * answer, whichever way round they are passed.
 */

import { normaliseProbs } from '@/lib/engine/math';
import type { ProbMap } from '@/lib/types';

export type EvidenceLevel = 'strong' | 'moderate' | 'thin' | 'none';

export interface EvidenceInput {
  homeMatches: number;
  awayMatches: number;
  ranked: { home: boolean; away: boolean };
  serveStats: { home: boolean; away: boolean };
  homeName?: string;
  awayName?: string;
}

export interface Evidence {
  level: EvidenceLevel;
  /** Multiplier applied to confidence, so a thin call cannot look certain. */
  factor: number;
  notes: string[];
}

export function evidenceFor(input: EvidenceInput): Evidence {
  const fewest = Math.min(input.homeMatches, input.awayMatches);
  const bothRanked = input.ranked.home && input.ranked.away;
  const eitherRanked = input.ranked.home || input.ranked.away;
  const bothServe = input.serveStats.home && input.serveStats.away;

  const notes: string[] = [];
  if (!eitherRanked) notes.push('Neither player has a published ranking');
  else if (!bothRanked) notes.push(`No published ranking for ${input.ranked.home ? (input.awayName ?? 'one player') : (input.homeName ?? 'one player')}`);
  if (input.homeMatches < 3) notes.push(`Only ${input.homeMatches} ${input.homeMatches === 1 ? 'match' : 'matches'} on record for ${input.homeName ?? 'the first player'}`);
  if (input.awayMatches < 3) notes.push(`Only ${input.awayMatches} ${input.awayMatches === 1 ? 'match' : 'matches'} on record for ${input.awayName ?? 'the second player'}`);
  if (!bothServe) notes.push('No serve statistics for at least one player');

  let level: EvidenceLevel;
  let factor: number;
  if (bothRanked && fewest >= 20 && bothServe) {
    level = 'strong';
    factor = 1;
  } else if (fewest >= 8 && eitherRanked) {
    level = 'moderate';
    factor = 0.85;
  } else if (fewest >= 3) {
    level = 'thin';
    factor = 0.6;
  } else {
    level = 'none';
    factor = 0.4;
  }
  return { level, factor, notes };
}

export interface TieBreakInput {
  probs: ProbMap;
  /** Competitor ids, used only for the stable final fallback. */
  home: string;
  away: string;
  epsilon: number;
  nudge: number;
  rank: { home: number | null; away: number | null };
  /** Weighted recent win rate, 0..1. */
  form: { home: number; away: number };
  /** Above zero favours home. */
  h2h: number;
  matches: { home: number; away: number };
}

export interface TieBreakResult {
  probs: ProbMap;
  favourite: 'HOME' | 'AWAY';
  reason: string | null;
  broken: boolean;
}

/**
 * Deliberately not a name or id comparison. Names are already sorted
 * alphabetically to decide which player is filed as home, so ordering by name
 * would hand every unresolvable match to the same half of the alphabet, and
 * ids are time-ordered, so they would favour whoever was added first.
 *
 * Note the low bit of an FNV hash is not usable here: multiplying by an odd
 * constant preserves it, so it reduces to the parity of the input characters
 * and barely varies. Each competitor is hashed whole and the larger hash
 * wins, which is unbiased, deterministic, and gives the same answer whichever
 * way round the pair arrives.
 */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Final avalanche, so close inputs do not land on close outputs.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

/** The competitor a coin flip would pick, chosen the same way every time. */
export function stablePick(a: string, b: string): string {
  const ha = fnv1a(a);
  const hb = fnv1a(b);
  if (ha !== hb) return ha > hb ? a : b;
  return a <= b ? a : b;
}

export function breakTie(input: TieBreakInput): TieBreakResult {
  const home = input.probs.HOME ?? 0.5;
  const away = input.probs.AWAY ?? 0.5;
  const leader: 'HOME' | 'AWAY' = home >= away ? 'HOME' : 'AWAY';
  if (input.probs.DRAW !== undefined || Math.abs(home - away) >= input.epsilon) {
    return { probs: input.probs, favourite: leader, reason: null, broken: false };
  }

  let favourite: 'HOME' | 'AWAY' | null = null;
  let reason: string | null = null;

  const { rank, form, h2h, matches } = input;
  if (rank.home !== null && rank.away !== null && rank.home !== rank.away) {
    favourite = rank.home < rank.away ? 'HOME' : 'AWAY';
    reason = `ranked #${Math.min(rank.home, rank.away)} against #${Math.max(rank.home, rank.away)}`;
  } else if (Math.abs(form.home - form.away) >= 0.02) {
    favourite = form.home > form.away ? 'HOME' : 'AWAY';
    reason = 'better recent form';
  } else if (h2h !== 0) {
    favourite = h2h > 0 ? 'HOME' : 'AWAY';
    reason = 'leads the head-to-head';
  } else if (matches.home !== matches.away) {
    favourite = matches.home > matches.away ? 'HOME' : 'AWAY';
    reason = 'more matches on record';
  } else {
    favourite = stablePick(input.home, input.away) === input.home ? 'HOME' : 'AWAY';
    reason = 'nothing separates them';
  }

  const nudged: ProbMap =
    favourite === 'HOME'
      ? { HOME: 0.5 + input.nudge, AWAY: 0.5 - input.nudge }
      : { HOME: 0.5 - input.nudge, AWAY: 0.5 + input.nudge };
  return { probs: normaliseProbs(nudged), favourite, reason, broken: true };
}
