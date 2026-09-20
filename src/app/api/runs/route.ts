import { z } from 'zod';

import { fail, guard, ok, readJson } from '@/lib/api';
import { JOB_HANDLERS } from '@/lib/jobs/registry';
import { isJobRunning, jobHandler, runJob, runningJobs } from '@/lib/jobs/runner';
import { prisma, withDatabase } from '@/lib/prisma';
import { serializeRun, type RunDto } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export interface RunsResponse {
  running: boolean;
  runningJobs: string[];
  runs: RunDto[];
  jobs: { name: string; label: string; kind: string; manualOnly: boolean }[];
}

/** GET /api/runs?limit=20&job=&sport= - recent runs plus what is running now. */
export async function GET(request: Request) {
  return guard(async () => {
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 20) || 20));
    const job = url.searchParams.get('job');
    const sportKey = url.searchParams.get('sport');
    const rows = await withDatabase(() =>
      prisma.modelRun.findMany({
        where: { ...(job ? { job } : {}), ...(sportKey && sportKey !== 'all' ? { sportKey } : {}) },
        orderBy: { startedAt: 'desc' },
        take: limit,
      }),
    );
    const response: RunsResponse = {
      running: isJobRunning(),
      runningJobs: runningJobs(),
      runs: rows.ok ? rows.data.map(serializeRun) : [],
      jobs: Object.entries(JOB_HANDLERS).map(([name, handler]) => ({
        name,
        label: handler.label,
        kind: handler.kind,
        manualOnly: handler.defaultIntervalMinutes === null,
      })),
    };
    return ok(response);
  }, 'GET /api/runs');
}

const bodySchema = z.object({
  job: z.string().min(1).max(60),
  sportKey: z.string().max(40).nullable().optional(),
  competitionId: z.string().max(60).nullable().optional(),
  options: z.record(z.unknown()).optional(),
});

/**
 * POST /api/runs - start a job in the background. Returns immediately; the
 * page polls /api/live (or GET /api/runs) for progress.
 */
export async function POST(request: Request) {
  return guard(async () => {
    const parsed = await readJson(request, bodySchema, 16 * 1024);
    if (!parsed.ok) return parsed.response;
    const { job, sportKey, competitionId, options } = parsed.data;
    if (!jobHandler(job)) return fail(`Unknown job "${job}".`, 404);
    const scope = { sportKey: sportKey && sportKey !== 'all' ? sportKey : null, competitionId: competitionId ?? null, options };
    if (isJobRunning(job, scope)) return ok({ started: false, message: 'That job is already running.' });
    void runJob(job, scope, 'manual');
    return ok({ started: true });
  }, 'POST /api/runs');
}
