import { guard, ok } from '@/lib/api';
import { usageToday } from '@/lib/providers/budget';
import { allProviders } from '@/lib/providers/registry';

export const dynamic = 'force-dynamic';

/** GET /api/providers - which adapters exist, whether they are configured, and today's usage. */
export async function GET() {
  return guard(async () => {
    const usage = await usageToday();
    const adapters = allProviders();
    return ok({
      providers: usage.map((u) => {
        const adapter = adapters.find((a) => a.key === u.provider);
        return {
          ...u,
          sports: adapter?.sports ?? [],
          capabilities: adapter?.capabilities ?? [],
          implemented: Boolean(adapter),
        };
      }),
    });
  }, 'GET /api/providers');
}
