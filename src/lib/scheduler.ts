/**
 * In-process scheduler.
 *
 * A one-minute tick runs every enabled `SyncJob` whose `nextDueAt` has
 * passed, one at a time. Started once per server process from
 * `instrumentation.ts`. Set SCHEDULER_ENABLED=false when host cron drives
 * /api/jobs/run instead.
 */

import { env } from '@/lib/env';
import { runDueJobs } from '@/lib/jobs/runner';

interface SchedulerState {
  timer: NodeJS.Timeout | null;
  ticking: boolean;
  bootedAt: Date;
}

const globalState = globalThis as unknown as { __scoresageScheduler?: SchedulerState };

const TICK_MS = 60_000;

export function startScheduler(): void {
  if (!env.schedulerEnabled) {
    console.log('[scoresage] scheduler disabled by SCHEDULER_ENABLED=false');
    return;
  }
  if (globalState.__scoresageScheduler?.timer) return;

  const state: SchedulerState = { timer: null, ticking: false, bootedAt: new Date() };
  state.timer = setInterval(() => {
    void tick(state);
  }, TICK_MS);
  // Never keep the process alive just for the timer.
  state.timer.unref?.();
  globalState.__scoresageScheduler = state;
  console.log('[scoresage] scheduler started');
}

export function stopScheduler(): void {
  const state = globalState.__scoresageScheduler;
  if (state?.timer) clearInterval(state.timer);
  globalState.__scoresageScheduler = undefined;
}

export async function tick(state: SchedulerState, now = new Date()): Promise<void> {
  if (state.ticking) return;
  state.ticking = true;
  try {
    await runDueJobs(now);
  } catch (error) {
    console.error('[scoresage] scheduler tick failed:', error instanceof Error ? error.message : error);
  } finally {
    state.ticking = false;
  }
}
