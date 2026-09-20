import { CheckCircle2, Circle, ExternalLink } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProviderUsageToday } from '@/lib/providers/budget';
import { providerBudgets } from '@/lib/providers/budget';
import { allProviders } from '@/lib/providers/registry';
import { cn, formatInt } from '@/lib/utils';

/** Which adapters exist, whether they have a key, and today's request count. */
export function ProvidersPanel({ usage }: { usage: ProviderUsageToday[] }) {
  const adapters = new Map(allProviders().map((p) => [p.key, p]));
  const budgets = new Map(providerBudgets().map((b) => [b.provider, b]));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Data providers</CardTitle>
        <CardDescription className="mt-1">
          Keys are read from .env on the server. Free tiers are budgeted per day; a job stops when a budget is spent and resumes the next day.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {usage.map((u) => {
            const adapter = adapters.get(u.provider);
            const budget = budgets.get(u.provider);
            const over = u.dailyBudget > 0 && u.requests >= u.dailyBudget;
            return (
              <li key={u.provider} className="flex items-center gap-3 py-2 text-sm">
                {u.configured ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Circle className="size-4 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    {u.label}
                    {budget?.docsUrl ? (
                      <a href={budget.docsUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Documentation">
                        <ExternalLink className="size-3" />
                      </a>
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {adapter ? `${adapter.sports.join(', ')} - ${adapter.capabilities.join(', ')}` : 'adapter planned; not built yet'}
                  </span>
                </span>
                <span className={cn('tnum text-xs', over ? 'text-danger' : 'text-muted-foreground')}>
                  {formatInt(u.requests)}
                  {u.dailyBudget > 0 ? ` / ${formatInt(u.dailyBudget)} today` : ' today'}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
