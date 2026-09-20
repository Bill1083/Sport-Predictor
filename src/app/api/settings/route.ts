import { fail, guard, ok, readJson } from '@/lib/api';
import {
  getGlobalSettings,
  getSportSettings,
  globalSettingsPatchSchema,
  sportSettingsPatchSchema,
  updateGlobalSettings,
  updateSportSettings,
} from '@/lib/settings';
import { isSportKey } from '@/lib/sports/registry';

export const dynamic = 'force-dynamic';

function scopeOf(request: Request): string {
  return new URL(request.url).searchParams.get('scope') ?? 'global';
}

/** GET /api/settings?scope=global|<sport> */
export async function GET(request: Request) {
  return guard(async () => {
    const scope = scopeOf(request);
    if (scope === 'global') return ok({ scope, settings: await getGlobalSettings() });
    if (!isSportKey(scope)) return fail('Unknown scope.', 404);
    return ok({ scope, settings: await getSportSettings(scope) });
  }, 'GET /api/settings');
}

/** PATCH /api/settings?scope=global|<sport> */
export async function PATCH(request: Request) {
  return guard(async () => {
    const scope = scopeOf(request);
    if (scope === 'global') {
      const parsed = await readJson(request, globalSettingsPatchSchema, 64 * 1024);
      if (!parsed.ok) return parsed.response;
      return ok({ scope, settings: await updateGlobalSettings(parsed.data) });
    }
    if (!isSportKey(scope)) return fail('Unknown scope.', 404);
    const parsed = await readJson(request, sportSettingsPatchSchema, 64 * 1024);
    if (!parsed.ok) return parsed.response;
    return ok({ scope, settings: await updateSportSettings(scope, parsed.data) });
  }, 'PATCH /api/settings');
}
