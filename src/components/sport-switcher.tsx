'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Check, ChevronsUpDown, Layers, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { SportIcon } from '@/components/sport-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api, errorMessage } from '@/lib/client';
import type { SportIconKey } from '@/lib/sports/registry';

export interface SportOption {
  key: string;
  name: string;
  icon: SportIconKey;
  mode: string;
  followed: number;
}

/**
 * The sport the dashboard is currently showing. Switching is a cookie and a
 * server render, exactly like a mailbox switch: every page follows it.
 */
export function SportSwitcher({ sports, selectedKey }: { sports: SportOption[]; selectedKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const selected = sports.find((s) => s.key === selectedKey) ?? null;
  const isAll = selectedKey === 'all';

  async function select(key: string) {
    if (key === selectedKey) return;
    setBusy(true);
    try {
      await api('/api/sports/select', { method: 'POST', json: { sportKey: key } });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (sports.length === 0) {
    return (
      <button
        type="button"
        onClick={() => router.push('/settings')}
        className="flex h-9 items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      >
        <Plus className="size-4" />
        <span className="hidden sm:inline">Add a sport</span>
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={busy}
          aria-label="Switch sport"
          className="flex h-9 max-w-[220px] items-center gap-2 rounded-md border bg-card px-2.5 text-sm transition-colors hover:bg-secondary/60 disabled:opacity-60"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-primary">
            {isAll || !selected ? <Layers className="size-3.5" /> : <SportIcon icon={selected.icon} className="size-3.5" />}
          </span>
          <span className="hidden min-w-0 truncate font-medium sm:inline">
            {isAll || !selected ? `All sports (${sports.length})` : selected.name}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Sport</DropdownMenuLabel>
        {sports.length > 1 ? (
          <DropdownMenuItem onSelect={() => select('all')}>
            <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Layers className="size-3.5" />
            </span>
            <span className="flex-1">All sports</span>
            {isAll ? <Check className="text-primary" /> : null}
          </DropdownMenuItem>
        ) : null}
        {sports.map((sport) => (
          <DropdownMenuItem key={sport.key} onSelect={() => select(sport.key)}>
            <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-foreground">
              <SportIcon icon={sport.icon} className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{sport.name}</span>
              <span className="text-[11px] text-muted-foreground">
                {sport.followed === 0
                  ? 'No competitions followed'
                  : `${sport.followed} competition${sport.followed === 1 ? '' : 's'}`}
                {' - '}
                {sport.mode === 'AI' ? 'AI' : sport.mode === 'ALGORITHM' ? 'algorithm' : 'hybrid'}
              </span>
            </span>
            {sport.key === selectedKey ? <Check className="text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/settings')}>
          <Plus />
          Add or configure sports
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
