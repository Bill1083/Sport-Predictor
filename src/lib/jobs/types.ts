/**
 * The contract every job implements. Jobs are pure functions of a scope and
 * a progress reporter; the runner owns locking, the ModelRun row and the
 * SyncJob bookkeeping.
 */

import type { RunTrigger } from '@/lib/types';

export type JobKind = 'SYNC' | 'PREDICT' | 'EVALUATE' | 'REFIT' | 'BACKTEST' | 'BACKFILL';

export interface JobScope {
  sportKey?: string | null;
  competitionId?: string | null;
  /** Free-form options a manual trigger may pass (e.g. a season to backfill). */
  options?: Record<string, unknown>;
}

export interface JobProgress {
  /** Name the current phase; resets the counter when the total changes. */
  phase(name: string, total?: number): Promise<void>;
  /** Advance the counter; the runner throttles writes. */
  tick(done?: number): Promise<void>;
  log(line: string): void;
  /** Accumulate spend reported by AI calls made inside the job. */
  cost(usd: number): void;
  readonly runId: string;
  readonly trigger: RunTrigger;
}

export interface JobResult {
  status: 'OK' | 'PARTIAL' | 'FAILED';
  message: string;
  metrics?: Record<string, unknown>;
}

export interface JobHandler {
  kind: JobKind;
  /** Human label for the Lab and the progress bar. */
  label: string;
  /** How often the scheduler should run it, or null for manual-only jobs. */
  defaultIntervalMinutes: number | null;
  /** Runs once per sport when true; otherwise once globally. */
  perSport: boolean;
  run(scope: JobScope, progress: JobProgress): Promise<JobResult>;
}
