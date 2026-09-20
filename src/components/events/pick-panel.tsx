'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, errorMessage } from '@/lib/client';
import { cn } from '@/lib/utils';

export interface PickDto {
  outcome: string;
  predictedScore: string | null;
  note: string | null;
}

/**
 * Your own call on the match, recorded before kickoff so the Accuracy page
 * can compare you with the model. Closed once the match starts; afterwards
 * it shows how you did.
 */
export function PickPanel({
  eventId,
  pick,
  outcomes,
  labels,
  open,
  result,
}: {
  eventId: string;
  pick: PickDto | null;
  outcomes: string[];
  labels: Record<string, string>;
  open: boolean;
  result: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [score, setScore] = useState(pick?.predictedScore ?? '');

  async function choose(outcome: string | null) {
    setBusy(true);
    try {
      await api(`/api/events/${eventId}/pick`, { method: 'POST', json: { outcome, predictedScore: score.trim() || null } });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    if (!pick) return null;
    const won = result !== null && result === pick.outcome;
    return (
      <p className="text-center text-xs text-muted-foreground">
        Your pick: <span className="font-medium text-foreground">{labels[pick.outcome] ?? pick.outcome}</span>
        {pick.predictedScore ? ` (${pick.predictedScore})` : ''}
        {result !== null ? <span className={cn('ml-2 font-semibold', won ? 'text-success' : 'text-danger')}>{won ? 'right' : 'wrong'}</span> : null}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <span className="text-xs text-muted-foreground">Your pick</span>
      {outcomes.map((o) => (
        <Button key={o} size="sm" variant={pick?.outcome === o ? 'default' : 'outline'} disabled={busy} onClick={() => choose(pick?.outcome === o ? null : o)}>
          {labels[o] ?? o}
        </Button>
      ))}
      <Input value={score} onChange={(e) => setScore(e.target.value)} placeholder="2-1" className="h-8 w-16 text-center" aria-label="Predicted score" />
      {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
    </div>
  );
}
