export type BalloonPalette = 'ICPC' | 'CUSTOM';

/** Preset balloon colors, assigned by problem position (A, B, C, …); wraps around after the last one. */
export const ICPC_BALLOON_COLORS: readonly { name: string; hex: string }[] = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#000000' },
  { name: 'Red', hex: '#ff0000' },
  { name: 'Dark red', hex: '#800000' },
  { name: 'Yellow', hex: '#ffff00' },
  { name: 'Green', hex: '#008000' },
  { name: 'Blue', hex: '#0000ff' },
  { name: 'Navy', hex: '#000080' },
  { name: 'Magenta', hex: '#ff00ff' },
  { name: 'Purple', hex: '#800080' },
  { name: 'Lime', hex: '#00ff00' },
  { name: 'Cyan', hex: '#00ffff' },
  { name: 'Silver', hex: '#c0c0c0' },
  { name: 'Orange', hex: '#ff8000' },
];

export const BALLOON_HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function presetBalloonColor(index: number): string {
  const n = ICPC_BALLOON_COLORS.length;
  return ICPC_BALLOON_COLORS[((index % n) + n) % n]!.hex;
}

/** Effective color per problem id; `problems` must be in display order. */
export function assignBalloonColors(
  palette: BalloonPalette,
  problems: readonly { id: string; balloonColor: string | null }[],
): Map<string, string> {
  const out = new Map<string, string>();
  problems.forEach((p, i) => {
    const custom = palette === 'CUSTOM' && p.balloonColor && BALLOON_HEX_RE.test(p.balloonColor) ? p.balloonColor : null;
    out.set(p.id, (custom ?? presetBalloonColor(i)).toLowerCase());
  });
  return out;
}

/** Black or white, whichever reads better on `hex`. */
export function balloonTextColor(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((v >> 16) & 255) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255);
  return l > 0.3 ? '#111111' : '#ffffff';
}

/** IOI cell opacity: 0 for no points, rising to 1 at the problem's maximum score. */
export function ioiColorStrength(scoreCenti: number, maxCenti: number | null): number {
  if (!maxCenti || scoreCenti <= 0) return 0;
  return 0.15 + 0.85 * Math.min(1, scoreCenti / maxCenti);
}

/** Near-white balloons can't get "stronger" on a white page, so IOI cells tint them gray instead. */
export function ioiTintColor(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].every((c) => c >= 0xe0) ? '#808080' : hex;
}
