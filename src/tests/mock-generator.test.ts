import { describe, expect, it } from 'vitest';

import { COASTAL, NORTHERN, eventStats, poisson, rng, roundRobin, seasonEvents } from '@/lib/providers/mock/generator';

describe('roundRobin', () => {
  it('schedules every pair twice, once at each venue', () => {
    const rounds = roundRobin(NORTHERN.teams);
    const n = NORTHERN.teams.length;
    expect(rounds).toHaveLength(2 * (n - 1));
    const seen = new Map<string, number>();
    for (const round of rounds) {
      expect(round).toHaveLength(n / 2);
      for (const [home, away] of round) {
        expect(home.externalId).not.toBe(away.externalId);
        const key = `${home.externalId}>${away.externalId}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
    }
    expect(seen.size).toBe(n * (n - 1));
    for (const count of seen.values()) expect(count).toBe(1);
  });
});

describe('seasonEvents', () => {
  // Mid-season: an 18-round demo season runs from mid-August to December.
  const now = new Date('2025-10-15T12:00:00Z');

  it('is deterministic: the same fixture always has the same result', () => {
    const a = seasonEvents(COASTAL, 2025, now);
    const b = seasonEvents(COASTAL, 2025, now);
    expect(a.map((e) => [e.externalId, e.result?.homeScore, e.result?.awayScore])).toEqual(
      b.map((e) => [e.externalId, e.result?.homeScore, e.result?.awayScore]),
    );
  });

  it('marks past matches finished with a winner, future ones scheduled', () => {
    const events = seasonEvents(COASTAL, 2025, now);
    const finished = events.filter((e) => e.status === 'FINISHED');
    const scheduled = events.filter((e) => e.status === 'SCHEDULED');
    expect(finished.length).toBeGreaterThan(0);
    expect(scheduled.length).toBeGreaterThan(0);
    for (const e of finished) {
      expect(e.startsAt.getTime()).toBeLessThan(now.getTime());
      expect(e.result?.winner).toMatch(/HOME|AWAY|DRAW/);
    }
    for (const e of scheduled) expect(e.startsAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('produces realistic scoring: mean goals per team between 1 and 1.8', () => {
    const events = seasonEvents(NORTHERN, 2024, new Date('2026-01-01T00:00:00Z'));
    const goals = events.flatMap((e) => [e.result?.homeScore ?? 0, e.result?.awayScore ?? 0]);
    const mean = goals.reduce((s, g) => s + g, 0) / goals.length;
    expect(mean).toBeGreaterThan(1);
    expect(mean).toBeLessThan(1.8);
  });

  it('yields per-team stats for finished events that add up sensibly', () => {
    const events = seasonEvents(NORTHERN, 2024, new Date('2026-01-01T00:00:00Z'));
    const finished = events.find((e) => e.status === 'FINISHED')!;
    const stats = eventStats(NORTHERN, finished);
    expect(stats).toHaveLength(2);
    const [home, away] = stats;
    expect(home.stats.goals).toBe(finished.result?.homeScore);
    expect(away.stats.goals).toBe(finished.result?.awayScore);
    expect(home.stats.possession + away.stats.possession).toBe(100);
    expect(home.stats.shotsOnTarget).toBeGreaterThanOrEqual(home.stats.goals);
    expect(home.stats.passes).toBeGreaterThan(200);
  });
});

describe('rng and poisson', () => {
  it('is reproducible from a seed and produces the requested mean', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const random = rng(7);
    let total = 0;
    const n = 5_000;
    for (let i = 0; i < n; i += 1) total += poisson(1.4, random);
    expect(total / n).toBeGreaterThan(1.3);
    expect(total / n).toBeLessThan(1.5);
  });
});
