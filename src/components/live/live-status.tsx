'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import type { LiveResponse } from '@/app/api/live/route';
import { api } from '@/lib/client';
import { formatInt } from '@/lib/utils';

/** While a job works, every couple of seconds; otherwise rarely. */
const ACTIVE_MS = 2_000;
const IDLE_MS = 20_000;

interface LiveContextValue {
  live: LiveResponse;
  running: boolean;
  /** Poll again immediately, e.g. just after starting a job. */
  refreshNow: () => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

/** Null outside a provider, so a component can work on pages without one. */
export function useLive(): LiveContextValue | null {
  return useContext(LiveContext);
}

/**
 * Polls the numbers that move while a job works and refreshes the page once
 * it finishes so every server-rendered part catches up. Backs right off when
 * nothing is running and stops entirely while the tab is hidden.
 */
export function LiveProvider({ initial, children }: { initial: LiveResponse; children: React.ReactNode }) {
  const router = useRouter();
  const [live, setLive] = useState<LiveResponse>(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRunning = useRef(Boolean(initial.run));
  const announced = useRef<string | null>(initial.lastFinished?.id ?? null);

  const running = live.run !== null;

  const poll = useCallback(async () => {
    try {
      const next = await api<LiveResponse>('/api/live');
      setLive(next);
      if (wasRunning.current && !next.run) {
        const finished = next.lastFinished;
        if (finished && announced.current !== finished.id) {
          announced.current = finished.id;
          const text = finished.summary ?? finished.error ?? finished.status;
          if (finished.status === 'FAILED') toast.error(text);
          else if (finished.status === 'PARTIAL') toast.warning(text);
          else toast.success(text);
        }
        router.refresh();
      }
      wasRunning.current = Boolean(next.run);
    } catch {
      // A failed poll is not worth surfacing; the next one will tell us.
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') await poll();
      if (cancelled) return;
      timer.current = setTimeout(tick, wasRunning.current ? ACTIVE_MS : IDLE_MS);
    };
    timer.current = setTimeout(tick, wasRunning.current ? ACTIVE_MS : IDLE_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [poll]);

  const refreshNow = useCallback(() => {
    wasRunning.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void poll(), 400);
  }, [poll]);

  const value = useMemo<LiveContextValue>(() => ({ live, running, refreshNow }), [live, running, refreshNow]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/**
 * A thin bar that only exists while a job does. A phase without a known
 * total shows a moving segment instead of a percentage it would invent.
 */
export function RunProgress() {
  const context = useLive();
  const run = context?.live.run ?? null;
  if (!run) return null;
  const known = run.progressTotal > 0;
  const percent = known ? Math.min(100, Math.round((run.progressDone / run.progressTotal) * 100)) : null;

  return (
    <div className="rounded-lg border bg-card px-3 py-2.5" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        <span className="font-medium">{run.job}</span>
        <span className="text-muted-foreground">{run.phase}</span>
        {known ? (
          <span className="tnum text-muted-foreground">
            {formatInt(run.progressDone)} of {formatInt(run.progressTotal)}
          </span>
        ) : null}
        {run.sportKey ? <span className="text-xs text-muted-foreground">- {run.sportKey}</span> : null}
        {percent !== null ? <span className="tnum ml-auto text-xs text-muted-foreground">{percent}%</span> : null}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        {percent !== null ? (
          <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${Math.max(2, percent)}%` }} />
        ) : (
          <div className="h-full w-1/3 rounded-full bg-primary animate-sweep" />
        )}
      </div>
    </div>
  );
}
