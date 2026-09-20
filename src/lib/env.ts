/**
 * Environment access.
 *
 * Nothing here throws on a missing key. The app boots on an empty `.env` and
 * the dashboard shows a setup checklist naming what is still missing. Values
 * under "engine defaults" only seed the Settings table on first boot; after
 * that the database wins (see `lib/settings.ts`).
 */

function read(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim().replace(/^"(.*)"$/, '$1');
  return trimmed.length > 0 ? trimmed : undefined;
}

function readInt(name: string, fallback: number): number {
  const raw = read(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readFloat(name: string, fallback: number): number {
  const raw = read(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = read(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type AiProviderKey = 'gemini' | 'anthropic' | 'none';
export type PredictionMode = 'ALGORITHM' | 'AI' | 'HYBRID';

export const env = {
  // --- core --------------------------------------------------------------
  get appUrl(): string {
    return (read('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
  },
  get timezone(): string {
    const tz = read('APP_TIMEZONE') ?? 'UTC';
    return isValidTimeZone(tz) ? tz : 'UTC';
  },
  get databaseUrl(): string | undefined {
    return read('DATABASE_URL');
  },
  get isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  },

  // --- dashboard access --------------------------------------------------
  get dashboardPassword(): string | undefined {
    return read('DASHBOARD_PASSWORD');
  },
  get sessionSecret(): string | undefined {
    return read('SESSION_SECRET');
  },
  /** How long a sign-in lasts before Google (or the password) is asked again. */
  get sessionTtlDays(): number {
    return Math.min(365, Math.max(1, readInt('SESSION_TTL_DAYS', 30)));
  },
  get cronSecret(): string | undefined {
    return read('CRON_SECRET');
  },
  /** Google identities allowed to sign in to the dashboard. */
  get dashboardAllowedEmails(): string[] {
    return (read('DASHBOARD_ALLOWED_EMAILS') ?? '')
      .split(/[,\s;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.includes('@'));
  },
  get googleLoginEnabled(): boolean {
    return Boolean(env.googleClientId && env.googleClientSecret) && env.dashboardAllowedEmails.length > 0;
  },
  get passwordLoginEnabled(): boolean {
    return Boolean(env.dashboardPassword);
  },
  get googleClientId(): string | undefined {
    return read('GOOGLE_CLIENT_ID');
  },
  get googleClientSecret(): string | undefined {
    return read('GOOGLE_CLIENT_SECRET');
  },

  // --- data providers ----------------------------------------------------
  get footballDataApiKey(): string | undefined {
    return read('FOOTBALL_DATA_API_KEY');
  },
  get apiSportsKey(): string | undefined {
    return read('API_SPORTS_KEY');
  },
  /** TheSportsDB's public demo key works for the v1 endpoints. */
  get theSportsDbKey(): string {
    return read('THESPORTSDB_KEY') ?? '123';
  },
  get cricketDataKey(): string | undefined {
    return read('CRICKETDATA_KEY');
  },
  get oddsApiKey(): string | undefined {
    return read('ODDS_API_KEY');
  },
  /** Seed value for the Settings toggle; the market benchmark is off by default. */
  get oddsEnabled(): boolean {
    return readBool('ENABLE_ODDS', false);
  },
  /** Daily request budgets, per provider. */
  get budgetApiSports(): number {
    return Math.max(0, readInt('PROVIDER_BUDGET_API_SPORTS', 90));
  },
  get budgetFootballData(): number {
    return Math.max(0, readInt('PROVIDER_BUDGET_FOOTBALL_DATA', 2_000));
  },
  get budgetTheSportsDb(): number {
    return Math.max(0, readInt('PROVIDER_BUDGET_THESPORTSDB', 2_000));
  },
  get budgetOpenMeteo(): number {
    return Math.max(0, readInt('PROVIDER_BUDGET_OPEN_METEO', 2_000));
  },
  get budgetCricketData(): number {
    return Math.max(0, readInt('PROVIDER_BUDGET_CRICKETDATA', 90));
  },
  get budgetOddsApi(): number {
    return Math.max(0, readInt('PROVIDER_BUDGET_ODDS_API', 12));
  },

  // --- AI ----------------------------------------------------------------
  get aiProvider(): AiProviderKey {
    const raw = read('AI_PROVIDER')?.toLowerCase();
    if (raw === 'anthropic' || raw === 'claude') return 'anthropic';
    if (raw === 'none' || raw === 'off') return 'none';
    return 'gemini';
  },
  get geminiApiKey(): string | undefined {
    // GOOGLE_API_KEY is what the SDK itself looks for; accept either.
    return read('GEMINI_API_KEY') ?? read('GOOGLE_API_KEY');
  },
  get geminiModel(): string {
    return read('GEMINI_MODEL') ?? 'gemini-3.8-flash';
  },
  get anthropicApiKey(): string | undefined {
    return read('ANTHROPIC_API_KEY');
  },
  get anthropicModel(): string {
    return read('ANTHROPIC_MODEL') ?? 'claude-opus-5';
  },
  get aiPriceInputPerM(): number {
    return readFloat('AI_PRICE_INPUT_PER_M', 0.75);
  },
  get aiPriceOutputPerM(): number {
    return readFloat('AI_PRICE_OUTPUT_PER_M', 3.75);
  },
  /** Spending cap per calendar month; the algorithm keeps running when it is hit. */
  get aiMonthlyBudgetUsd(): number {
    return Math.max(0, readFloat('AI_MONTHLY_BUDGET_USD', 10));
  },

  // --- engine defaults (seed values only) ---------------------------------
  get defaultPredictionMode(): PredictionMode {
    const raw = read('DEFAULT_PREDICTION_MODE')?.toUpperCase();
    return raw === 'ALGORITHM' || raw === 'AI' ? raw : 'HYBRID';
  },
  get predictHorizonDays(): number {
    return Math.min(60, Math.max(1, readInt('PREDICT_HORIZON_DAYS', 7)));
  },
  get refitTime(): string {
    return read('REFIT_TIME') ?? '03:00';
  },
  get fixtureSyncTime(): string {
    return read('FIXTURE_SYNC_TIME') ?? '05:00';
  },
  get schedulerEnabled(): boolean {
    return readBool('SCHEDULER_ENABLED', true);
  },
  /** Serve two invented leagues from fixtures instead of any real provider. */
  get mockSports(): boolean {
    return readBool('MOCK_SPORTS', false);
  },
} as const;

export interface IntegrationStatus {
  googleLogin: boolean;
  password: boolean;
  session: boolean;
  database: boolean;
  footballData: boolean;
  apiSports: boolean;
  theSportsDb: boolean;
  cricketData: boolean;
  oddsApi: boolean;
  gemini: boolean;
  anthropic: boolean;
  aiProvider: AiProviderKey;
  aiReady: boolean;
  mockSports: boolean;
}

/** Which integrations have credentials configured. Safe to send to the client. */
export function integrationStatus(): IntegrationStatus {
  const gemini = Boolean(env.geminiApiKey);
  const anthropic = Boolean(env.anthropicApiKey);
  const provider = env.aiProvider;
  return {
    googleLogin: env.googleLoginEnabled,
    password: env.passwordLoginEnabled,
    session: Boolean(env.sessionSecret),
    database: Boolean(env.databaseUrl),
    footballData: Boolean(env.footballDataApiKey),
    apiSports: Boolean(env.apiSportsKey),
    theSportsDb: true,
    cricketData: Boolean(env.cricketDataKey),
    oddsApi: Boolean(env.oddsApiKey),
    gemini,
    anthropic,
    aiProvider: provider,
    aiReady: provider === 'gemini' ? gemini : provider === 'anthropic' ? anthropic : false,
    mockSports: env.mockSports,
  };
}
