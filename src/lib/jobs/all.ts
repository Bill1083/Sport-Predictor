/**
 * Importing this module registers every job handler. The runner imports it,
 * so anything that can start a job has the full registry.
 */
import '@/lib/sync/jobs';
import '@/lib/engine/jobs';
