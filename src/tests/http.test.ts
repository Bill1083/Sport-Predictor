import { describe, expect, it } from 'vitest';

import { backoffMs, cacheKey, isRetryableStatus } from '@/lib/providers/http';

describe('isRetryableStatus', () => {
  it('retries rate limits, timeouts and server errors only', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe('backoffMs', () => {
  it('honours Retry-After in seconds, capped at a minute', () => {
    expect(backoffMs(1, '5')).toBe(5_000);
    expect(backoffMs(1, '600')).toBe(60_000);
  });

  it('grows exponentially with jitter and caps at 32s', () => {
    const first = backoffMs(1);
    const third = backoffMs(3);
    const tenth = backoffMs(10);
    expect(first).toBeGreaterThanOrEqual(1_000);
    expect(first).toBeLessThan(1_600);
    expect(third).toBeGreaterThanOrEqual(4_000);
    expect(third).toBeLessThan(4_600);
    expect(tenth).toBeGreaterThanOrEqual(32_000);
    expect(tenth).toBeLessThan(32_600);
  });
});

describe('cacheKey', () => {
  it('is stable for the same request and differs by provider, url and auth headers', () => {
    const a = cacheKey('football-data', 'https://x/y?z=1', { 'X-Auth-Token': 'k' });
    expect(cacheKey('football-data', 'https://x/y?z=1', { 'X-Auth-Token': 'k' })).toBe(a);
    expect(cacheKey('api-sports', 'https://x/y?z=1', { 'X-Auth-Token': 'k' })).not.toBe(a);
    expect(cacheKey('football-data', 'https://x/y?z=2', { 'X-Auth-Token': 'k' })).not.toBe(a);
    expect(cacheKey('football-data', 'https://x/y?z=1')).not.toBe(a);
    expect(a.startsWith('football-data:')).toBe(true);
    expect(a.length).toBe('football-data:'.length + 16);
  });
});
