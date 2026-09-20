import { cn, initials } from '@/lib/utils';

/** A team crest with a lettered fallback. Server-safe: no handlers. */
export function Crest({
  name,
  code,
  crestUrl,
  className,
  size = 'md',
}: {
  name: string;
  code?: string | null;
  crestUrl?: string | null;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box = size === 'lg' ? 'size-14 text-base' : size === 'sm' ? 'size-6 text-[10px]' : 'size-9 text-xs';
  if (crestUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={crestUrl} alt="" loading="lazy" className={cn('shrink-0 object-contain', box, className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-secondary font-semibold text-foreground', box, className)}
    >
      {code ?? initials(name)}
    </span>
  );
}

/**
 * The possession-style probability bar: home / draw / away as proportional
 * segments with the percentage inside each when there is room.
 */
export function ProbBar({
  home,
  draw,
  away,
  className,
  compact = false,
}: {
  home: number;
  draw?: number | null;
  away: number;
  className?: string;
  compact?: boolean;
}) {
  const segments = [
    { key: 'home', value: home, colour: 'bg-home text-white' },
    ...(typeof draw === 'number' ? [{ key: 'draw', value: draw, colour: 'bg-draw text-white' }] : []),
    { key: 'away', value: away, colour: 'bg-away text-white' },
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div className={cn('flex w-full overflow-hidden rounded-full bg-muted', compact ? 'h-2' : 'h-6', className)} role="img" aria-label={`Home ${Math.round(home * 100)}%${typeof draw === 'number' ? `, draw ${Math.round(draw * 100)}%` : ''}, away ${Math.round(away * 100)}%`}>
      {segments.map((s) => {
        const pct = (s.value / total) * 100;
        return (
          <div key={s.key} className={cn('flex items-center justify-center text-[11px] font-semibold tabular-nums transition-[width]', s.colour)} style={{ width: `${pct}%` }}>
            {!compact && pct >= 12 ? `${Math.round(pct)}%` : ''}
          </div>
        );
      })}
    </div>
  );
}

/** Small status chip for an event. */
export function StatusChip({ status, minute }: { status: string; minute?: number | null }) {
  if (status === 'LIVE') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger">
        <span className="size-1.5 rounded-full bg-danger animate-pulse-ring" />
        LIVE{typeof minute === 'number' ? ` ${minute}'` : ''}
      </span>
    );
  }
  const map: Record<string, { label: string; className: string }> = {
    FINISHED: { label: 'FT', className: 'bg-secondary text-muted-foreground' },
    POSTPONED: { label: 'Postponed', className: 'bg-warning/15 text-warning' },
    CANCELLED: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
  };
  const entry = map[status];
  if (!entry) return null;
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', entry.className)}>{entry.label}</span>;
}

/** W / D / L squares for a form string, oldest first. */
export function FormDots({ form, className }: { form: string; className?: string }) {
  if (!form) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <span className={cn('inline-flex gap-0.5', className)} aria-label={`Form ${form}`}>
      {form.split('').map((r, i) => (
        <span
          key={i}
          className={cn(
            'flex size-4 items-center justify-center rounded-sm text-[10px] font-bold text-white',
            r === 'W' ? 'bg-success' : r === 'L' ? 'bg-danger' : 'bg-draw',
          )}
        >
          {r}
        </span>
      ))}
    </span>
  );
}
