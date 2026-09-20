import { describe, expect, it } from 'vitest';

import { shiftHome } from '@/lib/ai/assess';
import { computeCostUsd } from '@/lib/ai/cost';
import { toGeminiSchema } from '@/lib/ai/gemini';
import { newsUrl, parseRss } from '@/lib/ai/news';
import { extractJson } from '@/lib/ai/provider';
import { aiAssessmentSchema, aiAssessmentValidator } from '@/lib/ai/schemas';

describe('shiftHome', () => {
  it('moves the home probability by the requested points and keeps the rest proportional', () => {
    const shifted = shiftHome({ HOME: 0.4, DRAW: 0.3, AWAY: 0.3 }, 6, ['HOME', 'DRAW', 'AWAY']);
    expect(shifted.HOME).toBeCloseTo(0.46, 6);
    expect(shifted.DRAW).toBeCloseTo(0.27, 6);
    expect(shifted.AWAY).toBeCloseTo(0.27, 6);
    expect(shifted.HOME + shifted.DRAW + shifted.AWAY).toBeCloseTo(1, 10);
  });

  it('never pushes a probability outside the guard rails', () => {
    const up = shiftHome({ HOME: 0.93, AWAY: 0.07 }, 20, ['HOME', 'AWAY']);
    expect(up.HOME).toBeLessThanOrEqual(0.95);
    const down = shiftHome({ HOME: 0.05, AWAY: 0.95 }, -20, ['HOME', 'AWAY']);
    expect(down.HOME).toBeGreaterThanOrEqual(0.03);
  });
});

describe('assessment schema', () => {
  it('accepts a well-formed reply and rejects an out-of-range effect', () => {
    const good = aiAssessmentValidator.safeParse({
      narrative: 'A tight one.',
      factors: [{ key: 'key_absence', label: 'Striker out', effect: -3, confidence: 'medium', note: 'Injury list' }],
      absences: [{ side: 'HOME', player: 'A Player', importance: 'key' }],
      confidence: 'medium',
    });
    expect(good.success).toBe(true);
    const bad = aiAssessmentValidator.safeParse({ narrative: 'x', factors: [{ key: 'k', label: 'l', effect: 40, confidence: 'low', note: 'n' }], absences: [], confidence: 'low' });
    expect(bad.success).toBe(false);
  });

  it('converts to a Gemini schema with typed properties and enums', () => {
    const schema = toGeminiSchema(aiAssessmentSchema);
    expect(schema.type).toBe('OBJECT');
    expect(schema.required).toContain('narrative');
    const factors = schema.properties?.factors;
    expect(factors?.type).toBe('ARRAY');
    expect(factors?.items?.properties?.confidence?.enum).toEqual(['low', 'medium', 'high']);
  });
});

describe('extractJson', () => {
  it('reads bare JSON, fenced JSON and JSON with prose around it', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Sure: {"a":3} there')).toEqual({ a: 3 });
    expect(() => extractJson('nothing here')).toThrow();
  });
});

describe('computeCostUsd', () => {
  it('prices input, cached input at a quarter, and output plus thinking', () => {
    const cost = computeCostUsd({ promptTokens: 1_000_000, outputTokens: 100_000, thoughtTokens: 100_000, cachedTokens: 0 }, 1, 4);
    expect(cost).toBeCloseTo(1 + 0.8, 8);
    const cached = computeCostUsd({ promptTokens: 1_000_000, outputTokens: 0, thoughtTokens: 0, cachedTokens: 1_000_000 }, 1, 4);
    expect(cached).toBeCloseTo(0.25, 8);
  });
});

describe('news', () => {
  it('builds a Google News query and parses an RSS feed', () => {
    expect(newsUrl('Harbourside Athletic', 'football')).toContain(encodeURIComponent('"Harbourside Athletic" football'));
    const xml = `<?xml version="1.0"?><rss><channel><title>t</title>
      <item><title>Striker ruled out for a month - Local Post</title><link>https://example.com/a</link><pubDate>Mon, 14 Sep 2026 10:00:00 GMT</pubDate><source url="https://localpost.example">Local Post</source></item>
      <item><title>Second story</title><link>https://example.com/b</link><pubDate>garbage</pubDate></item>
    </channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Striker ruled out for a month');
    expect(items[0].source).toBe('Local Post');
    expect(items[0].publishedAt.toISOString()).toBe('2026-09-14T10:00:00.000Z');
    expect(items[1].source).toBe('');
  });
});
