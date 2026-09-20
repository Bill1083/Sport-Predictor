'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/client';
import { formatRelative } from '@/lib/time';

export interface ModelRow {
  key: string;
  label: string;
  enabled: boolean;
  weight: number;
  params: Record<string, unknown>;
  help: string;
  fittedAt: string | null;
  hasState: boolean;
}

function ModelEditor({ sport, model }: { sport: string; model: ModelRow }) {
  const router = useRouter();
  const [weight, setWeight] = useState(model.weight);
  const [enabled, setEnabled] = useState(model.enabled);
  const [params, setParams] = useState(JSON.stringify(model.params, null, 2));
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const blendable = model.key !== 'ensemble' && model.key !== 'baseline' && model.key !== 'stats';

  async function save() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(params) as Record<string, unknown>;
    } catch {
      toast.error('Parameters must be valid JSON.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/models', { method: 'PATCH', json: { sport, modelKey: model.key, enabled, weight, params: parsed } });
      toast.success(`${model.label} saved.`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label={`Enable ${model.label}`} disabled={model.key === 'ensemble'} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {model.label}
            {model.hasState ? (
              <Badge variant="outline" className="ml-2 align-middle">
                fitted {model.fittedAt ? formatRelative(model.fittedAt) : ''}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{model.help}</p>
        </div>
        {blendable ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            weight
            <Input type="number" min={0} max={1} step={0.05} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="h-8 w-20" />
          </label>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Parameters'}
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
      </div>
      {open ? <Textarea value={params} onChange={(e) => setParams(e.target.value)} rows={Math.min(12, params.split('\n').length + 1)} className="mt-3 font-mono text-xs" /> : null}
    </div>
  );
}

export function ModelsPanel({ sport, sportName, models }: { sport: string; sportName: string; models: ModelRow[] }) {
  const router = useRouter();
  const [resetting, setResetting] = useState(false);

  async function reset() {
    if (!window.confirm(`Forget every fitted state and parameter change for ${sportName}? Defaults return and the next refit starts fresh.`)) return;
    setResetting(true);
    try {
      await api('/api/models', { method: 'PATCH', json: { sport, modelKey: 'ensemble', reset: true } });
      toast.success('Models reset to defaults.');
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">Models for {sportName}</CardTitle>
            <CardDescription className="mt-1">
              Weights feed the log-linear blend; the refit job sets them to what minimised log loss in the walk-forward pass, and you can override them here.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={reset} disabled={resetting}>
            {resetting ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Reset
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {models.map((model) => (
          <ModelEditor key={model.key} sport={sport} model={model} />
        ))}
      </CardContent>
    </Card>
  );
}
