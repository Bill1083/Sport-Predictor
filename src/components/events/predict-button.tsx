'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/client';

/** A fresh prediction version for this event, right now. */
export function PredictButton({ eventId, hasPrediction }: { eventId: string; hasPrediction: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function predict() {
    setBusy(true);
    try {
      const result = await api<{ predicted: number }>(`/api/events/${eventId}/predict`, { method: 'POST' });
      if (result.predicted > 0) toast.success('Prediction refreshed.');
      else toast.warning('Nothing predicted: the sport has no usable history yet.');
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button onClick={predict} disabled={busy} size="sm" variant={hasPrediction ? 'outline' : 'default'}>
      {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {busy ? 'Predicting...' : hasPrediction ? 'Refresh prediction' : 'Predict now'}
    </Button>
  );
}
