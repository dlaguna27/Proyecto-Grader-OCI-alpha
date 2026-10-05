/**
 * Scores are stored as integers in hundredths of a point ("centi-points") so
 * that all arithmetic is exact. A problem's `scorePrecision` (0..2) decides how
 * many of those decimals are meaningful.
 */
export const MAX_SCORE_PRECISION = 2;

export function precisionStep(precision: number): number {
  if (!Number.isInteger(precision) || precision < 0 || precision > MAX_SCORE_PRECISION) {
    throw new Error(`Invalid score precision ${precision}`);
  }
  return 10 ** (MAX_SCORE_PRECISION - precision);
}

/** Formats centi-points, e.g. formatScore(1250, 1) === "12.5". */
export function formatScore(centi: number, precision: number): string {
  const sign = centi < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(centi));
  const whole = Math.floor(abs / 100);
  if (precision === 0) return `${sign}${whole}`;
  const frac = String(abs % 100).padStart(2, '0').slice(0, precision);
  return `${sign}${whole}.${frac}`;
}

/**
 * Parses a user-entered point value into centi-points, rejecting values with
 * more decimals than `precision` allows. Returns null on invalid input.
 */
export function parseScore(input: string | number, precision: number): number | null {
  const s = String(input).trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const decimals = m[2] ?? '';
  if (decimals.replace(/0+$/, '').length > precision) return null;
  const whole = Number(m[1]);
  const frac = Number((decimals + '00').slice(0, 2));
  const value = whole * 100 + frac;
  return Number.isSafeInteger(value) ? value : null;
}

/** Converts a checker fraction in [0,1] to parts-per-million, clamping invalid input. */
export function fractionToPpm(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  if (fraction >= 1) return 1_000_000;
  return Math.round(fraction * 1_000_000);
}
