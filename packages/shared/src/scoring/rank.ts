/**
 * Sorts rows and assigns competition ranks ("1, 2, 2, 4"): rows comparing equal share a rank.
 * `tieBreak` orders equal rows for display only and does not affect rank.
 */
export function assignRanks<T>(
  rows: readonly T[],
  compare: (a: T, b: T) => number,
  tieBreak: (a: T, b: T) => number = () => 0,
): { row: T; rank: number }[] {
  const sorted = [...rows].sort((a, b) => compare(a, b) || tieBreak(a, b));
  const out: { row: T; rank: number }[] = [];
  sorted.forEach((row, i) => {
    const prev = out[i - 1];
    const rank = prev && compare(prev.row, row) === 0 ? prev.rank : i + 1;
    out.push({ row, rank });
  });
  return out;
}
