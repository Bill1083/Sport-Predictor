import { AppShell } from '@/components/app-shell';
import { describeIdentity } from '@/lib/auth';
import { prisma, withDatabase } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { listEnabledSports, resolveSportSelection, sportOptions, sportScope } from '@/lib/sports/selection';

export const dynamic = 'force-dynamic';

/**
 * Every dashboard page shares the shell: the sport switcher, navigation and
 * the live badge. The selected sport comes from a cookie, so switching is one
 * server render with no client-side data waterfall.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sports, session] = await Promise.all([listEnabledSports(), getSession()]);
  const { selected, selectedKey } = await resolveSportSelection(sports);
  const options = await sportOptions(sports);

  const live = await withDatabase(() =>
    prisma.event.count({ where: { ...sportScope(selected), status: 'LIVE' } }),
  );

  return (
    <AppShell
      sports={options}
      selectedKey={selectedKey}
      liveCount={live.ok ? live.data : 0}
      identity={session ? describeIdentity(session.identity) : null}
    >
      {children}
    </AppShell>
  );
}
