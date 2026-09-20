import { ok } from '@/lib/api';
import { isJobRunning, runningJobs } from '@/lib/jobs/runner';
import { prisma, withDatabase } from '@/lib/prisma';
import { usageToday } from '@/lib/providers/budget';
import { serializeRun, type RunDto } from '@/lib/serialize';

export const dynamic = 'force-dynamic';

export interface LiveResponse {
  /** The job currently working, if any. */
  run: RunDto | null;
  runningJobs: string[];
  /** The most recent finished run, so the page can report the outcome once. */
  lastFinished: RunDto | null;
  liveEvents: number;
  nextKickoff: string | null;
  usage: { provider: string; label: string; requests: number; dailyBudget: number; configured: boolean }[];
}

/**
 * GET /api/live
 *
 * The handful of numbers the pages refresh while a job works. Kept small
 * because the page polls it every couple of seconds.
 */
export async function GET() {
  const data = await withDatabase(async () => {
    const [running, lastFinished, liveEvents, next] = await Promise.all([
      prisma.modelRun.findFirst({ where: { status: 'RUNNING' }, orderBy: { startedAt: 'desc' } }),
      prisma.modelRun.findFirst({ where: { status: { not: 'RUNNING' } }, orderBy: { startedAt: 'desc' } }),
      prisma.event.count({ where: { status: 'LIVE' } }),
      prisma.event.findFirst({ where: { status: 'SCHEDULED', startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' }, select: { startsAt: true } }),
    ]);
    return { running, lastFinished, liveEvents, next };
  });
  const usage = (await usageToday()).filter((u) => u.configured);
  // A row left RUNNING by a restart is not actually working: the in-process lock decides.
  const live = data.ok && data.data.running && isJobRunning() ? data.data.running : null;
  const response: LiveResponse = {
    run: live ? serializeRun(live) : null,
    runningJobs: runningJobs(),
    lastFinished: data.ok && data.data.lastFinished ? serializeRun(data.data.lastFinished) : null,
    liveEvents: data.ok ? data.data.liveEvents : 0,
    nextKickoff: data.ok && data.data.next ? data.data.next.startsAt.toISOString() : null,
    usage: usage.map((u) => ({ provider: u.provider, label: u.label, requests: u.requests, dailyBudget: u.dailyBudget, configured: u.configured })),
  };
  return ok(response);
}
