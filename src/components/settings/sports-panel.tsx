'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { RunJobButton } from '@/components/shared/run-job-button';
import { SportIcon } from '@/components/sport-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/client';
import type { CompetitionDto, SportDto } from '@/lib/serialize';
import type { SportSettings } from '@/lib/settings';
import { cn } from '@/lib/utils';

export interface SportRow extends SportDto {
  followed: number;
  competitions: (CompetitionDto & { events: number })[];
  settings: SportSettings;
}

const MODE_HELP: Record<string, string> = {
  ALGORITHM: 'Statistical models only. No AI calls.',
  AI: 'The AI predicts from the stat pack; the algorithm runs silently for comparison.',
  HYBRID: 'Algorithm base with bounded AI adjustments and a narrative.',
};

function CompetitionsList({ sport }: { sport: SportRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  async function toggle(id: string, followed: boolean) {
    setBusy(id);
    try {
      await api('/api/competitions', { method: 'PATCH', json: { id, followed } });
      toast.success(followed ? 'Following. Fixtures are syncing in the background.' : 'Unfollowed.');
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  const list = sport.competitions.filter((c) => !filter || `${c.name} ${c.country ?? ''}`.toLowerCase().includes(filter.toLowerCase()));

  if (sport.competitions.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
        No competitions yet. Run the catalogue sync to load what your providers offer.
        <div className="mt-2">
          <RunJobButton job="sync:catalogue" sportKey={sport.key} label="Load competitions" size="sm" variant="outline" icon="refresh" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Filter competitions" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 max-w-xs" />
        <span className="text-xs text-muted-foreground">
          {sport.followed} of {sport.competitions.length} followed
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <RunJobButton job="sync:catalogue" sportKey={sport.key} label="Refresh catalogue" size="sm" variant="ghost" icon="refresh" />
          <RunJobButton job="sync:fixtures" sportKey={sport.key} label="Sync fixtures" size="sm" variant="outline" icon="refresh" disabled={sport.followed === 0} />
        </div>
      </div>
      <ul className="max-h-80 divide-y overflow-y-auto rounded-md border scrollbar-thin">
        {list.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Switch checked={c.followed} disabled={busy === c.id} onCheckedChange={(v) => toggle(c.id, v)} aria-label={`Follow ${c.name}`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[c.country, c.currentSeason ? `season ${c.currentSeason}` : null, c.events > 0 ? `${c.events} events` : null].filter(Boolean).join(' - ')}
              </span>
            </span>
            {busy === c.id ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            {Object.keys(c.providerIds).map((p) => (
              <Badge key={p} variant="outline" className="hidden sm:inline-flex">
                {p}
              </Badge>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SportSettingsForm({ sport }: { sport: SportRow }) {
  const router = useRouter();
  const [form, setForm] = useState<SportSettings>(sport.settings);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/api/settings?scope=${sport.key}`, { method: 'PATCH', json: form });
      toast.success('Saved.');
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const num = (key: keyof SportSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [key]: Number(e.target.value) });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1">
        <Label htmlFor={`${sport.key}-poll`}>Results poll (min)</Label>
        <Input id={`${sport.key}-poll`} type="number" min={5} max={1440} value={form.resultsPollMinutes} onChange={num('resultsPollMinutes')} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${sport.key}-ctx`}>Context refresh (hours before)</Label>
        <Input id={`${sport.key}-ctx`} type="number" min={1} max={168} value={form.contextHoursBefore} onChange={num('contextHoursBefore')} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${sport.key}-lineup`}>Lineups (min before)</Label>
        <Input id={`${sport.key}-lineup`} type="number" min={15} max={720} value={form.lineupMinutesBefore} onChange={num('lineupMinutesBefore')} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${sport.key}-order`}>Provider order</Label>
        <Input id={`${sport.key}-order`} placeholder="football-data,api-sports" value={form.providerOrder} onChange={(e) => setForm({ ...form, providerOrder: e.target.value })} />
      </div>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Switch id={`${sport.key}-weather`} checked={form.weather} onCheckedChange={(v) => setForm({ ...form, weather: v })} />
        <Label htmlFor={`${sport.key}-weather`}>Fetch weather for outdoor venues</Label>
      </div>
      <div className="flex items-end justify-end sm:col-span-2">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : null}
          Save {sport.name} settings
        </Button>
      </div>
    </div>
  );
}

export function SportsPanel({ sports }: { sports: SportRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sports.filter((s) => s.enabled).map((s) => [s.key, true])),
  );

  async function patch(key: string, body: { enabled?: boolean; mode?: string }) {
    setBusy(key);
    try {
      await api('/api/sports', { method: 'PATCH', json: { key, ...body } });
      if (body.enabled) {
        setOpen((o) => ({ ...o, [key]: true }));
        toast.success('Sport enabled. Loading its competitions...');
      }
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sports and competitions</CardTitle>
        <CardDescription className="mt-1">
          Switch on the sports you follow, choose how each is predicted, then follow the competitions you care about.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sports.map((sport) => (
          <div key={sport.key} className={cn('rounded-lg border', sport.enabled ? 'border-primary/30' : 'border-border')}>
            <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <Switch checked={sport.enabled} disabled={busy === sport.key} onCheckedChange={(v) => patch(sport.key, { enabled: v })} aria-label={`Enable ${sport.name}`} />
              <span className="flex size-7 items-center justify-center rounded-full bg-secondary">
                <SportIcon icon={sport.icon} className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {sport.name}
                  {sport.phase > 1 ? (
                    <Badge variant="outline" className="ml-2 align-middle">
                      {sport.phase === 2 ? 'sports pack 2' : 'later'}
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">{sport.description}</p>
              </div>
              {sport.enabled ? (
                <>
                  <Select value={sport.mode} onValueChange={(v) => patch(sport.key, { mode: v })}>
                    <SelectTrigger className="h-8 w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HYBRID">Hybrid</SelectItem>
                      <SelectItem value="ALGORITHM">Algorithm</SelectItem>
                      <SelectItem value="AI">AI</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" aria-label="Expand" onClick={() => setOpen((o) => ({ ...o, [sport.key]: !o[sport.key] }))}>
                    {open[sport.key] ? <ChevronUp /> : <ChevronDown />}
                  </Button>
                </>
              ) : null}
            </div>
            {sport.enabled && open[sport.key] ? (
              <div className="space-y-4 border-t px-3 py-3">
                <p className="text-xs text-muted-foreground">{MODE_HELP[sport.mode]}</p>
                <CompetitionsList sport={sport} />
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Sync cadence and providers</summary>
                  <div className="mt-3">
                    <SportSettingsForm sport={sport} />
                  </div>
                </details>
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
