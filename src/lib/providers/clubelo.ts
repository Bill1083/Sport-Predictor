/**
 * ClubElo: a free CSV of Elo ratings for every European club, per day.
 * Used as an external benchmark and a cold-start rating for teams the
 * database has no history for. Names are ClubElo's own compact spellings
 * ("ManCity", "NottmForest"), so matching goes through the normaliser.
 */

import { normaliseName, similarity } from '@/lib/entities/linking';
import { providerFetch } from '@/lib/providers/http';

export interface ClubEloRow {
  rank: number | null;
  club: string;
  country: string;
  level: number;
  elo: number;
  from: string;
  to: string;
}

export function parseClubElo(csv: string): ClubEloRow[] {
  const lines = csv.trim().split(/\r?\n/);
  const out: ClubEloRow[] = [];
  for (const line of lines.slice(1)) {
    const [rank, club, country, level, elo, from, to] = line.split(',');
    if (!club || !elo) continue;
    const value = Number(elo);
    if (!Number.isFinite(value)) continue;
    out.push({ rank: rank === 'None' || rank === '' ? null : Number(rank), club, country, level: Number(level), elo: value, from, to });
  }
  return out;
}

/** Split CamelCase compact names: "ManCity" -> "Man City", "NottmForest" -> "Nottm Forest". */
export function expandClubEloName(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\bNottm\b/, "Nott'm").replace(/\bMan\b/, 'Man');
}

/** Ratings on a day (defaults to today). */
export async function clubEloRatings(date = new Date()): Promise<ClubEloRow[]> {
  const day = date.toISOString().slice(0, 10);
  const response = await providerFetch('clubelo', `http://api.clubelo.com/${day}`, { ttlMs: 24 * 3_600_000, timeoutMs: 20_000 });
  return parseClubElo(response.body);
}

/**
 * Match our team names to ClubElo rows. Exact normalised match first, then
 * a strict similarity threshold; anything looser is left unmatched.
 */
export function matchClubElo(teams: { id: string; name: string; country?: string | null }[], rows: ClubEloRow[]): Map<string, ClubEloRow> {
  const out = new Map<string, ClubEloRow>();
  const byNorm = new Map<string, ClubEloRow>();
  for (const row of rows) byNorm.set(normaliseName(expandClubEloName(row.club)), row);
  for (const team of teams) {
    const norm = normaliseName(team.name);
    const exact = byNorm.get(norm);
    if (exact) {
      out.set(team.id, exact);
      continue;
    }
    let best: { row: ClubEloRow; score: number } | null = null;
    for (const [candidate, row] of byNorm) {
      const score = similarity(norm, candidate);
      if (score > 0.92 && (!best || score > best.score)) best = { row, score };
    }
    if (best) out.set(team.id, best.row);
  }
  return out;
}
