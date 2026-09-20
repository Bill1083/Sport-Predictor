/**
 * The one HTTP path every provider uses.
 *
 *   cache -> budget -> pacing -> fetch with timeout -> retry with backoff
 *
 * Responses are cached in the database for the TTL the caller chooses, so a
 * re-sync of the same fixtures costs nothing and a recorded response can be
 * replayed in tests. The budget ledger is charged for real requests only.
 * Pacing is a module-level cursor per provider, so bursts from several jobs
 * are smoothed across the whole process.
 */

import { prisma, withDatabase } from '@/lib/prisma';
import { budgetFor, recordUsage, remainingToday } from '@/lib/providers/budget';
import { BudgetExhaustedError, ProviderError, type ProviderKey } from '@/lib/providers/provider';

export interface FetchOptions {
  headers?: Record<string, string>;
  /** Cache lifetime. 0 disables caching for this call. */
  ttlMs?: number;
  timeoutMs?: number;
  /** Bypass the cache even if a fresh entry exists. */
  force?: boolean;
  maxAttempts?: number;
  /** Treat these statuses as an empty success (e.g. 404 for "no such season"). */
  emptyStatuses?: number[];
}

export interface FetchResult {
  status: number;
  body: string;
  fromCache: boolean;
}

const nextSlot = new Map<ProviderKey, number>();
const DEFAULT_TIMEOUT_MS = 30_000;

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for the provider's next free slot, then claim the one after it. */
async function takeSlot(provider: ProviderKey, minGapMs: number): Promise<void> {
  if (minGapMs <= 0) return;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(provider) ?? 0);
  nextSlot.set(provider, slot + minGapMs);
  await sleep(slot - now);
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Honour `Retry-After` when present (capped at 60s); otherwise exponential
 * backoff from one second with jitter, capped at 32s.
 */
export function backoffMs(attempt: number, retryAfterHeader?: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(60_000, seconds * 1000);
    const at = Date.parse(retryAfterHeader);
    if (Number.isFinite(at)) return Math.min(60_000, Math.max(0, at - Date.now()));
  }
  const base = Math.min(32_000, 1000 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 500);
}

/** FNV-1a over the text, twice with different seeds, as 16 hex characters. */
function fnv(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Cache key for a provider request. No crypto module so this file can sit
 * in any bundle; the cached row also stores the URL and is checked on read,
 * so a collision can never serve the wrong response.
 */
export function cacheKey(provider: ProviderKey, url: string, headers?: Record<string, string>): string {
  const auth = headers ? Object.keys(headers).sort().join(',') : '';
  const text = `${provider}\n${url}\n${auth}`;
  return `${provider}:${fnv(text, 2166136261)}${fnv(text, 0x9747b28c)}`;
}

async function readCache(key: string, url: string, now: Date): Promise<FetchResult | null> {
  const row = await withDatabase(() => prisma.httpCache.findUnique({ where: { key } }));
  if (!row.ok || !row.data || row.data.url !== url || row.data.expiresAt <= now) return null;
  return { status: row.data.status, body: row.data.body, fromCache: true };
}

async function writeCache(key: string, url: string, status: number, body: string, ttlMs: number): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await withDatabase(() =>
    prisma.httpCache.upsert({
      where: { key },
      create: { key, url, status, body, expiresAt },
      update: { url, status, body, fetchedAt: new Date(), expiresAt },
    }),
  );
}

/** Drop expired cache rows; called by the daily fixture sync. */
export async function pruneCache(now = new Date()): Promise<number> {
  const result = await withDatabase(() => prisma.httpCache.deleteMany({ where: { expiresAt: { lt: now } } }));
  return result.ok ? result.data.count : 0;
}

/**
 * Fetch text for a provider. Throws ProviderError for non-retryable failures
 * and after the last retry, BudgetExhaustedError when today's budget is spent.
 */
export async function providerFetch(provider: ProviderKey, url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const budget = budgetFor(provider);
  const ttlMs = options.ttlMs ?? 0;
  const key = cacheKey(provider, url, options.headers);
  const now = new Date();

  if (ttlMs > 0 && !options.force) {
    const cached = await readCache(key, url, now);
    if (cached) return cached;
  }

  if ((await remainingToday(provider, now)) <= 0) {
    throw new BudgetExhaustedError(provider, budget.dailyBudget);
  }

  const maxAttempts = options.maxAttempts ?? 4;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: ProviderError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await takeSlot(provider, budget.minGapMs);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json, text/plain, */*', ...(options.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch (error) {
      await recordUsage(provider, true);
      const message = error instanceof Error ? error.message : 'network error';
      lastError = new ProviderError(provider, `${provider}: ${message}`, 0, true);
      if (attempt < maxAttempts) await sleep(backoffMs(attempt));
      continue;
    }

    const body = await response.text();
    const failed = !response.ok && !(options.emptyStatuses ?? []).includes(response.status);
    await recordUsage(provider, failed);

    if (response.ok || (options.emptyStatuses ?? []).includes(response.status)) {
      const result: FetchResult = { status: response.status, body, fromCache: false };
      if (ttlMs > 0) await writeCache(key, url, response.status, body, ttlMs);
      return result;
    }

    const retryable = isRetryableStatus(response.status);
    lastError = new ProviderError(
      provider,
      `${provider} returned HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`,
      response.status,
      retryable,
    );
    if (!retryable || attempt === maxAttempts) break;
    await sleep(backoffMs(attempt, response.headers.get('retry-after')));
  }

  throw lastError ?? new ProviderError(provider, `${provider}: request failed`, 0, true);
}

/** `providerFetch` plus JSON parsing with a clear error on garbage. */
export async function providerJson<T>(provider: ProviderKey, url: string, options: FetchOptions = {}): Promise<T> {
  const result = await providerFetch(provider, url, options);
  if (!result.body.trim()) return {} as T;
  try {
    return JSON.parse(result.body) as T;
  } catch {
    throw new ProviderError(provider, `${provider} returned a response that was not JSON.`, result.status, false);
  }
}
