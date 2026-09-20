import { ok } from '@/lib/api';
import { integrationStatus } from '@/lib/env';
import { isDatabaseReachable } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Liveness and configuration probe. Used by the Docker health check; it
 * reveals only whether each integration is configured, never the values.
 */
export async function GET() {
  const configured = integrationStatus();
  const databaseReachable = await isDatabaseReachable();
  const flag = (value: boolean) => (value ? 'configured' : 'missing');

  return ok({
    status: 'ok',
    time: new Date().toISOString(),
    integrations: {
      googleLogin: flag(configured.googleLogin),
      password: flag(configured.password),
      session: flag(configured.session),
      footballData: flag(configured.footballData),
      apiSports: flag(configured.apiSports),
      theSportsDb: flag(configured.theSportsDb),
      cricketData: flag(configured.cricketData),
      oddsApi: flag(configured.oddsApi),
      ai: `${configured.aiProvider}:${configured.aiReady ? 'ready' : 'missing-key'}`,
      mockSports: configured.mockSports ? 'on' : 'off',
      database: databaseReachable ? 'reachable' : configured.database ? 'unreachable' : 'not-configured',
    },
  });
}
