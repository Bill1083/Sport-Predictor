import { z } from 'zod';

import { fail, guard, ok, readJson } from '@/lib/api';
import { loadModelConfigs, resetModelConfigs, updateModelConfig } from '@/lib/engine/config';
import { isSportKey } from '@/lib/sports/registry';

export const dynamic = 'force-dynamic';

/** GET /api/models?sport=football - model settings and when each was fitted. */
export async function GET(request: Request) {
  return guard(async () => {
    const sport = new URL(request.url).searchParams.get('sport') ?? '';
    if (!isSportKey(sport)) return fail('Unknown sport.', 404);
    const configs = await loadModelConfigs(sport);
    return ok({
      sport,
      models: Array.from(configs.values()).map((m) => ({
        ...m.settings,
        fittedAt: m.fittedAt ? m.fittedAt.toISOString() : null,
        hasState: Boolean(m.state),
      })),
    });
  }, 'GET /api/models');
}

const patchSchema = z.object({
  sport: z.string().min(1),
  modelKey: z.string().min(1),
  enabled: z.boolean().optional(),
  weight: z.number().min(0).max(1).optional(),
  params: z.record(z.unknown()).optional(),
  reset: z.boolean().optional(),
});

/** PATCH /api/models - change a model's weight, switch or parameters; `reset` forgets everything fitted. */
export async function PATCH(request: Request) {
  return guard(async () => {
    const parsed = await readJson(request, patchSchema, 64 * 1024);
    if (!parsed.ok) return parsed.response;
    const { sport, modelKey, reset, ...patch } = parsed.data;
    if (!isSportKey(sport)) return fail('Unknown sport.', 404);
    if (reset) {
      await resetModelConfigs(sport);
      return ok({ reset: true });
    }
    await updateModelConfig(sport, modelKey, patch);
    return ok({ ok: true });
  }, 'PATCH /api/models');
}
