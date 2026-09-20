/**
 * Runs jobs: one at a time per job name, with a ModelRun row that records
 * live progress, the outcome and any AI spend, plus SyncJob bookkeeping for
 * the recurring ones.
 */

import { env } from '@/lib/env';
import '@/lib/jobs/all';
import { JOB_HANDLERS } from '@/lib/jobs/registry';
import type { JobHandler, JobProgress, JobResult, JobScope } from '@/lib/jobs/types';
import { prisma, withDatabase } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import type { RunTrigger } from '@/lib/types';

export interface RunOutcome extends JobResult {
  runId: string | null;
}

const locks = new Map<string, Promise<RunOutcome>>();

function lockKey(job: string, scope: JobScope): string {
  return `${job}:${scope.sportKey ?? '*'}:${scope.competitionId ?? '*'}`;
}

export function isJobRunning(job?: string, scope?: JobScope): boolean {
  if (!job) return locks.size > 0;
  if (!scope) return Array.from(locks.keys()).some((key) => key.startsWith(`${job}:`));
  return locks.has(lockKey(job, scope));
}

export function runningJobs(): string[] {
  return Array.from(locks.keys());
}

export function jobHandler(job: string): JobHandler | undefined {
  return JOB_HANDLERS[job];
}

/** Start a job unless the same job is already running for the same scope. */
export function runJob(job: string, scope: JobScope, trigger: RunTrigger): Promise<RunOutcome> {
  const key = lockKey(job, scope);
  const existing = locks.get(key);
  if (existing) return existing;
  const promise = execute(job, scope, trigger).finally(() => locks.delete(key));
  locks.set(key, promise);
  return promise;
}

const PROGRESS_WRITE_MS = 750;

async function execute(job: string, scope: JobScope, trigger: RunTrigger): Promise<RunOutcome> {
  const handler = JOB_HANDLERS[job];
  if (!handler) return { runId: null, status: 'FAILED', message: `Unknown job "${job}".` };

  const created = await withDatabase(() =>
    prisma.modelRun.create({
      data: {
        kind: handler.kind,
        job,
        sportKey: scope.sportKey ?? null,
        competitionId: scope.competitionId ?? null,
        trigger,
      },
    }),
  );
  if (!created.ok) return { runId: null, status: 'FAILED', message: 'The database could not be reached.' };
  const runId = created.data.id;

  const lines: string[] = [];
  let phase = 'queued';
  let done = 0;
  let total = 0;
  let cost = 0;
  let lastWrite = 0;
  let pending: Promise<unknown> | null = null;

  const flush = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < PROGRESS_WRITE_MS) return;
    lastWrite = now;
    pending = withDatabase(() =>
      prisma.modelRun.update({
        where: { id: runId },
        data: { phase, progressDone: done, progressTotal: total, costUsd: cost },
      }),
    );
    await pending;
  };

  const progress: JobProgress = {
    runId,
    trigger,
    async phase(name, newTotal) {
      phase = name;
      done = 0;
      total = newTotal ?? 0;
      await flush(true);
    },
    async tick(step = 1) {
      done += step;
      await flush();
    },
    log(line) {
      lines.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
      if (lines.length > 400) lines.splice(0, lines.length - 400);
    },
    cost(usd) {
      cost += usd;
    },
  };

  const startedAt = Date.now();
  let result: JobResult;
  try {
    progress.log(`${handler.label} started (${trigger})`);
    result = await handler.run(scope, progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[scoresage] job ${job} failed:`, message);
    result = { status: 'FAILED', message };
  }
  if (pending) await pending;

  progress.log(`${result.status}: ${result.message} (${Math.round((Date.now() - startedAt) / 1000)}s)`);
  await withDatabase(() =>
    prisma.modelRun.update({
      where: { id: runId },
      data: {
        status: result.status,
        phase: 'done',
        progressDone: total > 0 ? total : done,
        progressTotal: total,
        error: result.status === 'OK' ? null : result.message.slice(0, 1_000),
        metricsJson: result.metrics ? JSON.stringify(result.metrics) : null,
        log: lines.join('\n'),
        costUsd: cost,
        finishedAt: new Date(),
      },
    }),
  );
  if (result.status !== 'OK' || trigger !== 'schedule') {
    console.log(`[scoresage] ${job}${scope.sportKey ? ` [${scope.sportKey}]` : ''}: ${result.status} - ${result.message}`);
  }
  return { runId, ...result };
}

/**
 * Make sure every recurring job has a SyncJob row per enabled sport, so the
 * scheduler can find it. Idempotent; called on boot and when a sport is
 * enabled.
 */
export async function ensureSyncJobs(): Promise<void> {
  const sports = await withDatabase(() => prisma.sport.findMany({ where: { enabled: true } }));
  if (!sports.ok) return;
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const [job, handler] of Object.entries(JOB_HANDLERS)) {
    if (handler.defaultIntervalMinutes === null) continue;
    const scopes = handler.perSport ? sports.data.map((s) => s.key) : ['*'];
    for (const sportKey of scopes) {
      writes.push(
        prisma.syncJob.upsert({
          where: { job_sportKey_competitionId: { job, sportKey, competitionId: '' } },
          create: { job, sportKey, intervalMinutes: handler.defaultIntervalMinutes, nextDueAt: new Date() },
          update: {},
        }),
      );
    }
  }
  if (writes.length > 0) await withDatabase(() => prisma.$transaction(writes));
}

/** Everything the scheduler tick does: find due jobs and run them in turn. */
export async function runDueJobs(now = new Date()): Promise<void> {
  if (!env.schedulerEnabled) return;
  const due = await withDatabase(() =>
    prisma.syncJob.findMany({
      where: { enabled: true, nextDueAt: { lte: now } },
      orderBy: { nextDueAt: 'asc' },
    }),
  );
  if (!due.ok) return;

  for (const row of due.data) {
    const handler = JOB_HANDLERS[row.job];
    if (!handler) continue;
    const scope: JobScope = {
      sportKey: row.sportKey === '*' ? null : row.sportKey,
      competitionId: row.competitionId || null,
    };
    // Claim the slot first so a slow job is never started twice.
    const next = new Date(now.getTime() + Math.max(1, row.intervalMinutes) * 60_000);
    await withDatabase(() =>
      prisma.syncJob.update({ where: { id: row.id }, data: { lastRunAt: now, nextDueAt: next } }),
    );
    const outcome = await runJob(row.job, scope, 'schedule');
    await withDatabase(() =>
      prisma.syncJob.update({
        where: { id: row.id },
        data: { lastStatus: outcome.status, lastError: outcome.status === 'OK' ? null : outcome.message.slice(0, 500) },
      }),
    );
  }
}
