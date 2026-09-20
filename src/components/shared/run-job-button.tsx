'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { useLive } from '@/components/live/live-status';
import { Button } from '@/components/ui/button';
import type { RunsResponse } from '@/app/api/runs/route';
import { api, errorMessage } from '@/lib/client';

/**
 * Starts a job and reports how it went. On a page with a LiveProvider the
 * provider does the polling and the toast; elsewhere this polls on its own.
 */
export function RunJobButton({
  job,
  sportKey,
  competitionId,
  options,
  label,
  busyLabel = 'Working...',
  icon = 'play',
  variant = 'default',
  size = 'default',
  disabled = false,
}: {
  job: string;
  sportKey?: string | null;
  competitionId?: string | null;
  options?: Record<string, unknown>;
  label: string;
  busyLabel?: string;
  icon?: 'play' | 'refresh';
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm';
  disabled?: boolean;
}) {
  const router = useRouter();
  const live = useLive();
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = live ? live.running : running;

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function poll(attempt = 0) {
    try {
      const data = await api<RunsResponse>(`/api/runs?job=${encodeURIComponent(job)}&limit=1`);
      if (data.running && attempt < 900) {
        timer.current = setTimeout(() => void poll(attempt + 1), 2_000);
        return;
      }
      setRunning(false);
      const latest = data.runs[0];
      if (latest) {
        const text = latest.summary ?? latest.error ?? latest.status;
        if (latest.status === 'FAILED') toast.error(text);
        else if (latest.status === 'PARTIAL') toast.warning(text);
        else toast.success(text);
      }
      router.refresh();
    } catch (error) {
      setRunning(false);
      toast.error(errorMessage(error));
    }
  }

  async function start() {
    setRunning(true);
    try {
      const result = await api<{ started: boolean; message?: string }>('/api/runs', {
        method: 'POST',
        json: { job, sportKey: sportKey ?? null, competitionId: competitionId ?? null, options },
      });
      if (!result.started) toast.info(result.message ?? 'Already running.');
      if (live) live.refreshNow();
      else timer.current = setTimeout(() => void poll(), 1_500);
    } catch (error) {
      setRunning(false);
      toast.error(errorMessage(error));
    }
  }

  const Icon = icon === 'refresh' ? RefreshCw : Play;
  return (
    <Button onClick={start} disabled={disabled || busy} variant={variant} size={size}>
      {busy ? <Loader2 className="animate-spin" /> : <Icon />}
      {busy ? busyLabel : label}
    </Button>
  );
}
