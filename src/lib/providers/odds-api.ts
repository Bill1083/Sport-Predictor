/**
 * The Odds API (optional): bookmaker prices for a competition, devigged into
 * implied probabilities and averaged across books. Stored as a snapshot per
 * event and shown only as a "market implied %" comparison next to the
 * models. Free tier is 500 credits a month, so the sync runs once a day.
 */

import { normaliseName, similarity } from '@/lib/entities/linking';
import { env } from '@/lib/env';
import { providerJson } from '@/lib/providers/http';
import type { ProbMap } from '@/lib/types';

const BASE = 'https://api.the-odds-api.com/v4';

export interface OddsEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: { key: string; title: string; markets?: { key: string; outcomes?: { name: string; price: number }[] }[] }[];
}

/** Remove the overround: normalise the reciprocals of the decimal prices. */
export function devig(outcomes: { name: string; price: number }[], homeTeam: string, awayTeam: string): ProbMap | null {
  const inv = outcomes.filter((o) => o.price > 1).map((o) => ({ name: o.name, p: 1 / o.price }));
  const total = inv.reduce((s, o) => s + o.p, 0);
  if (inv.length < 2 || total <= 0) return null;
  const out: ProbMap = {};
  for (const o of inv) {
    const key = o.name === homeTeam ? 'HOME' : o.name === awayTeam ? 'AWAY' : /draw/i.test(o.name) ? 'DRAW' : null;
    if (key) out[key] = o.p / total;
  }
  return out.HOME !== undefined && out.AWAY !== undefined ? out : null;
}

/** Consensus across bookmakers: the mean of each outcome's devigged probability. */
export function consensus(event: OddsEvent): { implied: ProbMap; bookmakers: number } | null {
  const perBook: ProbMap[] = [];
  for (const book of event.bookmakers ?? []) {
    const market = book.markets?.find((m) => m.key === 'h2h');
    if (!market?.outcomes) continue;
    const implied = devig(market.outcomes, event.home_team, event.away_team);
    if (implied) perBook.push(implied);
  }
  if (perBook.length === 0) return null;
  const keys = Array.from(new Set(perBook.flatMap((p) => Object.keys(p))));
  const implied: ProbMap = {};
  for (const key of keys) implied[key] = perBook.reduce((s, p) => s + (p[key] ?? 0), 0) / perBook.length;
  const total = Object.values(implied).reduce((s, v) => s + v, 0);
  for (const key of keys) implied[key] = Math.round((implied[key] / total) * 10_000) / 10_000;
  return { implied, bookmakers: perBook.length };
}

/** Does a bookmaker event describe one of ours? Names normalised, kickoff within two hours. */
export function matches(event: OddsEvent, ours: { home: string; away: string; startsAt: Date }): boolean {
  const gap = Math.abs(Date.parse(event.commence_time) - ours.startsAt.getTime());
  if (gap > 2 * 3_600_000) return false;
  const h = similarity(normaliseName(event.home_team), normaliseName(ours.home));
  const a = similarity(normaliseName(event.away_team), normaliseName(ours.away));
  return h >= 0.85 && a >= 0.85;
}

export async function fetchOdds(oddsSportKey: string): Promise<OddsEvent[]> {
  if (!env.oddsApiKey) return [];
  const url = `${BASE}/sports/${encodeURIComponent(oddsSportKey)}/odds?apiKey=${encodeURIComponent(env.oddsApiKey)}&regions=uk,eu&markets=h2h&oddsFormat=decimal&dateFormat=iso`;
  const data = await providerJson<OddsEvent[]>('odds-api', url, { ttlMs: 12 * 3_600_000, timeoutMs: 20_000, maxAttempts: 2 });
  return Array.isArray(data) ? data : [];
}
