import type { SportIconKey } from '@/lib/sports/registry';
import { cn } from '@/lib/utils';

/**
 * Small inline marks for each sport. Lucide has no football or cricket bat,
 * so these are hand-drawn on a 24-unit grid in the same stroke style.
 */
export function SportIcon({ icon, className }: { icon: SportIconKey; className?: string }) {
  const props = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    className: cn('size-4', className),
  };
  switch (icon) {
    case 'football':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 7.2l4 2.9-1.5 4.7h-5L8 10.1z" />
          <path d="M12 7.2V3M16 10.1l4-1.3M14.5 14.8l2.6 3.6M9.5 14.8l-2.6 3.6M8 10.1L4 8.8" />
        </svg>
      );
    case 'rugby':
      return (
        <svg {...props}>
          <path d="M4.5 19.5c-1.6-1.6-.6-7.1 3.2-10.9S17.9 2.9 19.5 4.5s.6 7.1-3.2 10.9-10.2 5.7-11.8 4.1z" />
          <path d="M9 15l6-6M10.5 12l1.5 1.5M12 10.5l1.5 1.5M13.5 9l1.5 1.5" />
        </svg>
      );
    case 'cricket':
      return (
        <svg {...props}>
          <path d="M14.5 3.5l6 6-9.5 9.5a2.1 2.1 0 0 1-3-3z" />
          <path d="M4.5 19.5l3-3" />
          <circle cx="6" cy="6" r="2.5" />
        </svg>
      );
    case 'tennis':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M5.5 5.5c4 2 6 4.5 6 8s-2 6-6 8M18.5 5.5c-4 2-6 4.5-6 8s2 6 6 8" />
        </svg>
      );
    case 'f1':
      return (
        <svg {...props}>
          <path d="M3 17h5l1.5-3H15l1.5-3H21" />
          <path d="M6 20l2-3M17 11l2-3" />
          <circle cx="7" cy="20" r="1.5" />
          <circle cx="17" cy="20" r="1.5" />
          <path d="M8.5 20h7" />
        </svg>
      );
    case 'basketball':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 2.5v19M2.5 12h19M5.3 5.3c3.7 3.7 3.7 9.7 0 13.4M18.7 5.3c-3.7 3.7-3.7 9.7 0 13.4" />
        </svg>
      );
    case 'american-football':
      return (
        <svg {...props}>
          <path d="M4.5 19.5c-1.6-1.6-.6-7.1 3.2-10.9S17.9 2.9 19.5 4.5s.6 7.1-3.2 10.9-10.2 5.7-11.8 4.1z" />
          <path d="M8.5 15.5l7-7M10 11.5l2.5 2.5M12.5 9l2.5 2.5" />
        </svg>
      );
    case 'hockey':
      return (
        <svg {...props}>
          <path d="M14 3l-6 12.5a2 2 0 0 0 1.8 3H14" />
          <ellipse cx="17.5" cy="18" rx="3.5" ry="1.6" />
        </svg>
      );
    case 'baseball':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.5" />
          <path d="M6 5c2.5 2 3.7 4.3 3.7 7s-1.2 5-3.7 7M18 5c-2.5 2-3.7 4.3-3.7 7s1.2 5 3.7 7" />
          <path d="M7.5 8.5l1.5.5M7.5 15.5l1.5-.5M16.5 8.5l-1.5.5M16.5 15.5l-1.5-.5" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9.5" />
        </svg>
      );
  }
}
