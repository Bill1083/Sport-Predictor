import Link from 'next/link';
import { CheckCircle2, Circle, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { IntegrationStatus } from '@/lib/env';
import { cn } from '@/lib/utils';

interface Item {
  done: boolean;
  label: string;
  hint: string;
  info?: boolean;
}

export function SetupChecklist({
  status,
  enabledSports,
  followedCompetitions,
  eventsKnown,
}: {
  status: IntegrationStatus;
  enabledSports: number;
  followedCompetitions: number;
  eventsKnown: number;
}) {
  const anyProvider = status.footballData || status.apiSports || status.cricketData || status.mockSports;
  const items: Item[] = [
    {
      done: status.session,
      label: 'Session secret',
      hint: 'Set SESSION_SECRET in .env (openssl rand -base64 32) so you can sign in.',
    },
    {
      done: status.googleLogin || status.password,
      label: 'A way to sign in',
      hint: 'Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and DASHBOARD_ALLOWED_EMAILS, or DASHBOARD_PASSWORD for local use.',
    },
    {
      done: anyProvider,
      label: 'A data provider key',
      hint: 'Set FOOTBALL_DATA_API_KEY and/or API_SPORTS_KEY, or MOCK_SPORTS=true to explore with invented leagues.',
    },
    {
      done: enabledSports > 0,
      label: 'A sport switched on',
      hint: 'Enable at least one sport in Settings.',
    },
    {
      done: followedCompetitions > 0,
      label: 'A competition followed',
      hint: 'Follow a league or cup in Settings; fixtures and results sync from there.',
    },
    {
      done: eventsKnown > 0,
      label: 'Fixtures synced',
      hint: 'Press Sync now, or wait for the scheduled fixture sync.',
    },
    {
      done: status.aiReady || status.aiProvider === 'none',
      label: 'AI provider key',
      hint:
        status.aiProvider === 'anthropic'
          ? 'Set ANTHROPIC_API_KEY, or switch the provider in Settings. Predictions run on the algorithm alone until then.'
          : 'Set GEMINI_API_KEY, or switch the provider in Settings. Predictions run on the algorithm alone until then.',
      info: true,
    },
  ];
  const outstanding = items.filter((item) => !item.done);
  if (outstanding.length === 0) return null;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Setup</CardTitle>
        <CardDescription className="mt-1">A few things are still needed before ScoreSage can predict on its own.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.label} className="flex items-start gap-2.5 text-sm">
              {item.done ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : item.info ? (
                <Info className="mt-0.5 size-4 shrink-0 text-warning" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className={cn('font-medium', item.done && 'text-muted-foreground line-through')}>{item.label}</p>
                {!item.done ? <p className="text-xs text-muted-foreground">{item.hint}</p> : null}
              </div>
            </li>
          ))}
        </ul>
        <Button asChild size="sm" variant="outline" className="mt-2">
          <Link href="/settings">Open settings</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
