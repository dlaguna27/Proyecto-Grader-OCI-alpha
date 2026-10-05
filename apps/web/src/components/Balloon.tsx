import type { CSSProperties } from 'react';
import { balloonTextColor, ioiColorStrength, ioiTintColor } from '@noi/shared';
import { cn } from '@/lib/utils';

export function Balloon({ color, className, title }: { color: string; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 32" className={cn('inline-block h-5 w-auto shrink-0', className)} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <path
        d="M12 1C6.5 1 3 5.4 3 10.5c0 5.6 4.3 10.4 8.2 11.4L10 24h4l-1.2-2.1C16.7 20.9 21 16.1 21 10.5 21 5.4 17.5 1 12 1Z"
        fill={color}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="1"
      />
      <ellipse cx="8.5" cy="7.5" rx="2" ry="3" fill="#fff" opacity="0.35" transform="rotate(-25 8.5 7.5)" />
      <path d="M12 24c-1.5 2.5 1.5 4 0 7" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1" />
    </svg>
  );
}

/** IOI cell background: the problem's balloon color, stronger the closer the score is to the maximum. */
export function ioiCellStyle(scoreCenti: number, maxCenti: number | null, color: string): CSSProperties | undefined {
  const a = ioiColorStrength(scoreCenti, maxCenti);
  if (!a) return undefined;
  color = ioiTintColor(color);
  const alpha = Math.round(a * 255).toString(16).padStart(2, '0');
  return { backgroundColor: `${color}${alpha}`, color: a >= 0.6 ? balloonTextColor(color) : undefined, fontWeight: a === 1 ? 600 : undefined };
}
