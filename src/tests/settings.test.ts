import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultGlobalSettings, defaultSportSettings, resolveGlobalSettings, resolveSportSettings } from '@/lib/settings';

// Vitest loads the local .env; pin the seeds so the assertions do not depend on it.
beforeEach(() => {
  vi.stubEnv('AI_PROVIDER', 'gemini');
  vi.stubEnv('PREDICT_HORIZON_DAYS', '7');
  vi.stubEnv('REFIT_TIME', '03:00');
  vi.stubEnv('DEFAULT_PREDICTION_MODE', 'HYBRID');
});
afterEach(() => vi.unstubAllEnvs());

describe('resolveGlobalSettings', () => {
  it('falls back to the env seeds when nothing is stored', () => {
    const settings = resolveGlobalSettings({});
    expect(settings).toEqual(defaultGlobalSettings());
    expect(settings.aiProvider).toBe('gemini');
    expect(settings.predictHorizonDays).toBe(7);
    expect(settings.refitTime).toBe('03:00');
  });

  it('parses stored values and clamps numbers', () => {
    const settings = resolveGlobalSettings({
      aiProvider: 'anthropic',
      predictHorizonDays: '999',
      aiMonthlyBudgetUsd: '25.5',
      oddsEnabled: 'true',
      refitTime: '4:30',
    });
    expect(settings.aiProvider).toBe('anthropic');
    expect(settings.predictHorizonDays).toBe(60);
    expect(settings.aiMonthlyBudgetUsd).toBe(25.5);
    expect(settings.oddsEnabled).toBe(true);
    expect(settings.refitTime).toBe('04:30');
  });

  it('ignores unknown keys and unparsable values', () => {
    const settings = resolveGlobalSettings({ aiProvider: 'openai', aiEffort: 'max', predictHorizonDays: 'lots', nonsense: '1' });
    expect(settings.aiProvider).toBe('gemini');
    expect(settings.aiEffort).toBe('low');
    expect(settings.predictHorizonDays).toBe(7);
    expect('nonsense' in settings).toBe(false);
  });
});

describe('resolveSportSettings', () => {
  it('defaults to hybrid mode with sane cadences', () => {
    const settings = resolveSportSettings({});
    expect(settings).toEqual(defaultSportSettings());
    expect(settings.mode).toBe('HYBRID');
    expect(settings.resultsPollMinutes).toBe(15);
    expect(settings.lineupMinutesBefore).toBe(90);
  });

  it('accepts a valid mode and clamps the poll interval', () => {
    const settings = resolveSportSettings({ mode: 'ALGORITHM', resultsPollMinutes: '1', providerOrder: 'api-sports,football-data' });
    expect(settings.mode).toBe('ALGORITHM');
    expect(settings.resultsPollMinutes).toBe(5);
    expect(settings.providerOrder).toBe('api-sports,football-data');
  });
});
