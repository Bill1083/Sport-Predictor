import { Target } from 'lucide-react';

import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/stat-card';

export const dynamic = 'force-dynamic';

export default function AccuracyPage() {
  return (
    <>
      <PageHeader title="Accuracy" description="Every final prediction scored against the result: Brier, log loss, ranked probability score, calibration." />
      <EmptyState
        icon={Target}
        title="No scored predictions yet"
        description="Predictions are scored automatically once their events finish. The engine arrives in the next build."
      />
    </>
  );
}
