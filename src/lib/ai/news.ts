/**
 * Headlines about a team from Google News RSS: no key, cached for six hours
 * through the provider HTTP layer, kept as NewsItem rows so the match page
 * can show what the AI read.
 */

import { XMLParser } from 'fast-xml-parser';

import { prisma, withDatabase } from '@/lib/prisma';
import { providerFetch } from '@/lib/providers/http';

export interface Headline {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
}

const SPORT_TERMS: Record<string, string> = {
  football: 'football',
  rugby_union: 'rugby',
  rugby_league: 'rugby league',
  cricket: 'cricket',
  tennis: 'tennis',
  f1: 'F1',
  basketball: 'basketball',
  american_football: 'NFL',
  ice_hockey: 'NHL',
  baseball: 'MLB',
};

export function newsUrl(teamName: string, sportKey: string): string {
  const term = SPORT_TERMS[sportKey] ?? '';
  const query = `"${teamName}" ${term}`.trim();
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-GB&gl=GB&ceid=GB:en`;
}

export function parseRss(xml: string, limit = 10): Headline[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const channel = (doc as { rss?: { channel?: { item?: unknown } } })?.rss?.channel;
  const items = channel?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  const out: Headline[] = [];
  for (const raw of list) {
    const item = raw as { title?: unknown; link?: unknown; pubDate?: unknown; source?: unknown };
    const title = typeof item.title === 'string' ? item.title : '';
    const url = typeof item.link === 'string' ? item.link : '';
    if (!title || !url) continue;
    const source = typeof item.source === 'string' ? item.source : typeof item.source === 'object' && item.source && '#text' in item.source ? String((item.source as { '#text': unknown })['#text']) : '';
    const publishedAt = typeof item.pubDate === 'string' && !Number.isNaN(Date.parse(item.pubDate)) ? new Date(item.pubDate) : new Date();
    // Google appends " - Source" to titles; strip it when the source is known.
    const cleanTitle = source && title.endsWith(` - ${source}`) ? title.slice(0, -(source.length + 3)) : title;
    out.push({ title: cleanTitle, url, source, publishedAt });
    if (out.length >= limit) break;
  }
  return out;
}

/** Recent headlines for a team, fetched (cached 6h) and stored. */
export async function headlinesFor(teamId: string, teamName: string, sportKey: string, maxAgeDays = 10): Promise<Headline[]> {
  let fetched: Headline[] = [];
  try {
    const response = await providerFetch('news-rss', newsUrl(teamName, sportKey), { ttlMs: 6 * 3_600_000, timeoutMs: 15_000, maxAttempts: 2 });
    fetched = parseRss(response.body);
  } catch (error) {
    console.warn('[scoresage] news fetch failed:', error instanceof Error ? error.message : error);
  }
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000);
  const recent = fetched.filter((h) => h.publishedAt >= cutoff);
  for (const h of recent) {
    await withDatabase(async () => {
      const existing = await prisma.newsItem.findFirst({ where: { url: h.url, teamId } });
      if (!existing) await prisma.newsItem.create({ data: { sportKey, teamId, title: h.title, url: h.url, source: h.source, publishedAt: h.publishedAt } });
    });
  }
  if (recent.length > 0) return recent;
  const stored = await withDatabase(() => prisma.newsItem.findMany({ where: { teamId, publishedAt: { gte: cutoff } }, orderBy: { publishedAt: 'desc' }, take: 10 }));
  return stored.ok ? stored.data.map((n) => ({ title: n.title, url: n.url, source: n.source, publishedAt: n.publishedAt })) : [];
}
