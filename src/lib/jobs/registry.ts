/**
 * Every job the runner knows about, keyed by name. Sync and engine jobs
 * register themselves here as they are added.
 */

import type { JobHandler } from '@/lib/jobs/types';

export const JOB_HANDLERS: Record<string, JobHandler> = {};

export function registerJob(name: string, handler: JobHandler): void {
  JOB_HANDLERS[name] = handler;
}
