'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/client';
import type { IntegrationStatus } from '@/lib/env';
import type { GlobalSettings } from '@/lib/settings';

export function GlobalSettingsForm({ initial, status }: { initial: GlobalSettings; status: IntegrationStatus }) {
  const router = useRouter();
  const [form, setForm] = useState<GlobalSettings>(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api('/api/settings?scope=global', { method: 'PATCH', json: form });
      toast.success('Saved.');
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const num = (key: keyof GlobalSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: Number(e.target.value) });
  const str = (key: keyof GlobalSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const keyMissing = (form.aiProvider === 'gemini' && !status.gemini) || (form.aiProvider === 'anthropic' && !status.anthropic);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">AI</CardTitle>
          <CardDescription className="mt-1">
            Which model reads the news, adjusts the algorithm in hybrid mode and writes the narratives. Keys live in .env.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Provider</Label>
              <Select value={form.aiProvider} onValueChange={(v) => setForm({ ...form, aiProvider: v as GlobalSettings['aiProvider'] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini">Google Gemini{status.gemini ? '' : ' (no key)'}</SelectItem>
                  <SelectItem value="anthropic">Anthropic Claude{status.anthropic ? '' : ' (no key)'}</SelectItem>
                  <SelectItem value="none">None (algorithm only)</SelectItem>
                </SelectContent>
              </Select>
              {keyMissing ? <p className="text-xs text-warning">No key for this provider; predictions run on the algorithm alone.</p> : null}
            </div>
            <div className="space-y-1">
              <Label>Thinking effort</Label>
              <Select value={form.aiEffort} onValueChange={(v) => setForm({ ...form, aiEffort: v as GlobalSettings['aiEffort'] })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low (fast, cheap)</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="gemini-model">Gemini model</Label>
              <Input id="gemini-model" value={form.geminiModel} onChange={str('geminiModel')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="anthropic-model">Claude model</Label>
              <Input id="anthropic-model" value={form.anthropicModel} onChange={str('anthropicModel')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="price-in">Price per 1M input tokens (USD)</Label>
              <Input id="price-in" type="number" step="0.01" min={0} value={form.priceInputPerM} onChange={num('priceInputPerM')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="price-out">Price per 1M output tokens (USD)</Label>
              <Input id="price-out" type="number" step="0.01" min={0} value={form.priceOutputPerM} onChange={num('priceOutputPerM')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="budget">Monthly AI budget (USD)</Label>
              <Input id="budget" type="number" step="1" min={0} value={form.aiMonthlyBudgetUsd} onChange={num('aiMonthlyBudgetUsd')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cap">Hybrid adjustment cap (pp)</Label>
              <Input id="cap" type="number" step="1" min={0} max={30} value={form.aiAdjustmentCap} onChange={num('aiAdjustmentCap')} />
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.aiContext} onCheckedChange={(v) => setForm({ ...form, aiContext: v })} />
              Read news and injuries into context
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={form.aiNarratives} onCheckedChange={(v) => setForm({ ...form, aiNarratives: v })} />
              Write a narrative per prediction
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Engine and schedule</CardTitle>
          <CardDescription className="mt-1">How far ahead to predict, when to refit, and whether the market benchmark is on.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="horizon">Prediction horizon (days)</Label>
              <Input id="horizon" type="number" min={1} max={60} value={form.predictHorizonDays} onChange={num('predictHorizonDays')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="refit">Weekly refit time</Label>
              <Input id="refit" placeholder="03:00" value={form.refitTime} onChange={str('refitTime')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fixture-sync">Daily fixture sync time</Label>
              <Input id="fixture-sync" placeholder="05:00" value={form.fixtureSyncTime} onChange={str('fixtureSyncTime')} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.oddsEnabled} onCheckedChange={(v) => setForm({ ...form, oddsEnabled: v })} disabled={!status.oddsApi && !status.apiSports} />
            Market implied % benchmark (needs ODDS_API_KEY or API_SPORTS_KEY)
          </label>
          <p className="text-xs text-muted-foreground">
            Shown only as a comparison column next to the model. It is never advice and never used to place anything.
          </p>
          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
