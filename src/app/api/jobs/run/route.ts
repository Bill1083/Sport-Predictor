import { fail, guard, ok } from '@/lib/api';
import { safeEqual } from '@/lib/auth';
import { env } from '@/lib/env';
import { jobHandler, runDueJobs, runJob } from '@/lib/jobs/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/jobs/run?job=sync:fixtures&sport=football
 *
 * Cron entry point, `Authorization: Bearer CRON_SECRET`. Without `job` it
 * runs whatever is due, exactly like a scheduler tick.
 */
export async function POST(request: Request) {
  return guard(async () => {
    const secret = env.cronSecret;
    if (!secret) return fail('CRON_SECRET is not configured.', 503);
    const header = request.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !safeEqual(token, secret)) return fail('Unauthorised.', 401);

    const url = new URL(request.url);
    const job = url.searchParams.get('job');
    if (!job) {
      await runDueJobs();
      return ok({ ok: true, ran: 'due' });
    }
    if (!jobHandler(job)) return fail(`Unknown job "${job}".`, 404);
    const outcome = await runJob(job, { sportKey: url.searchParams.get('sport'), competitionId: url.searchParams.get('competition') }, 'cron');
    return ok(outcome);
  }, 'POST /api/jobs/run');
}
