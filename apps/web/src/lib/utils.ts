import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatScore } from '@noi/shared';
import { locale } from './i18n';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function score(centi: number | null | undefined, precision: number): string {
  return centi === null || centi === undefined ? '–' : formatScore(centi, precision);
}

export function fmtTime(d: string | Date): string {
  return new Date(d).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtClock(d: string | Date): string {
  return new Date(d).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}

/** datetime-local input value in the browser's local time zone. */
export function toLocalInput(d: string | Date | null | undefined): string {
  if (!d) return '';
  const x = new Date(d);
  const off = x.getTimezoneOffset() * 60000;
  return new Date(x.getTime() - off).toISOString().slice(0, 16);
}

export function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}
