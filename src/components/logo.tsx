import { cn } from '@/lib/utils';

/** The ScoreSage mark: a pitch seen from above with a gold "sage" spark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn('size-5', className)}>
      <circle cx="32" cy="32" r="21" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle cx="32" cy="32" r="8" fill="none" stroke="currentColor" strokeWidth="4" />
      <line x1="32" y1="8" x2="32" y2="56" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <circle cx="44" cy="20" r="6" fill="hsl(var(--gold))" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display text-base font-semibold tracking-tight', className)}>
      Score<span className="text-primary">Sage</span>
    </span>
  );
}
