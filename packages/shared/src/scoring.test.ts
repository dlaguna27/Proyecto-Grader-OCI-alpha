import { describe, expect, it } from 'vitest';
import {
  assignRanks,
  compareIcpcTotals,
  formatScore,
  fractionToPpm,
  icpcProblemState,
  icpcTotals,
  ioiTaskScore,
  parseScore,
  scoreSubmission,
  subtaskScore,
  type IcpcSubmission,
  type SubtaskDef,
} from './index.js';

const F = (entries: Record<string, number>) => new Map(Object.entries(entries));
const FULL = 1_000_000;

describe('score formatting', () => {
  it('formats with precision', () => {
    expect(formatScore(1250, 0)).toBe('12');
    expect(formatScore(1250, 1)).toBe('12.5');
    expect(formatScore(1205, 2)).toBe('12.05');
    expect(formatScore(0, 2)).toBe('0.00');
  });
  it('parses and enforces precision', () => {
    expect(parseScore('12.5', 1)).toBe(1250);
    expect(parseScore('12.50', 1)).toBe(1250);
    expect(parseScore('12.5', 0)).toBeNull();
    expect(parseScore('33.33', 2)).toBe(3333);
    expect(parseScore('33.333', 2)).toBeNull();
    expect(parseScore('-1', 2)).toBeNull();
    expect(parseScore(40, 0)).toBe(4000);
  });
  it('clamps fractions', () => {
    expect(fractionToPpm(NaN)).toBe(0);
    expect(fractionToPpm(-1)).toBe(0);
    expect(fractionToPpm(2)).toBe(FULL);
    expect(fractionToPpm(0.5)).toBe(500_000);
  });
});

describe('IOI subtask scoring', () => {
  const minSt: SubtaskDef = { id: 's1', pointsCenti: 3000, scoring: 'MIN', testIds: ['a', 'b', 'c'] };
  const sumSt: SubtaskDef = { id: 's2', pointsCenti: 1000, scoring: 'SUM', testIds: ['a', 'b', 'c'] };

  it('MIN is all-or-nothing on binary tests', () => {
    expect(subtaskScore(minSt, F({ a: FULL, b: FULL, c: FULL }), 0)).toBe(3000);
    expect(subtaskScore(minSt, F({ a: FULL, b: 0, c: FULL }), 0)).toBe(0);
    expect(subtaskScore(minSt, F({ a: FULL, b: FULL }), 0)).toBe(0); // missing = 0
  });

  it('MIN uses the minimum partial fraction', () => {
    expect(subtaskScore(minSt, F({ a: FULL, b: 500_000, c: 750_000 }), 2)).toBe(1500);
  });

  it('SUM is proportional and floored to precision', () => {
    // 10 points * 2/3 = 6.666...
    const f = F({ a: FULL, b: FULL, c: 0 });
    expect(subtaskScore(sumSt, f, 2)).toBe(666);
    expect(subtaskScore(sumSt, f, 1)).toBe(660);
    expect(subtaskScore(sumSt, f, 0)).toBe(600);
  });

  it('never exceeds points and ignores garbage fractions', () => {
    expect(subtaskScore(minSt, F({ a: 5 * FULL, b: FULL, c: FULL }), 2)).toBe(3000);
    expect(subtaskScore(minSt, F({ a: -3, b: FULL, c: FULL }), 2)).toBe(0);
  });

  it('is independent of map order', () => {
    const subs = [minSt, sumSt];
    const a = scoreSubmission(subs, F({ a: FULL, b: 300_000, c: FULL }), 2);
    const b = scoreSubmission(subs, F({ c: FULL, b: 300_000, a: FULL }), 2);
    expect(a).toEqual(b);
  });

  it('handles large point values exactly', () => {
    const big: SubtaskDef = { id: 'x', pointsCenti: 99_999_999, scoring: 'SUM', testIds: Array.from({ length: 997 }, (_, i) => `t${i}`) };
    const fr = new Map(big.testIds.map((id) => [id, FULL]));
    expect(subtaskScore(big, fr, 2)).toBe(99_999_999);
  });
});

describe('IOI task score', () => {
  const s1 = { totalCenti: 4000, subtasks: [{ id: 'a', scoreCenti: 4000 }, { id: 'b', scoreCenti: 0 }] };
  const s2 = { totalCenti: 6000, subtasks: [{ id: 'a', scoreCenti: 0 }, { id: 'b', scoreCenti: 6000 }] };
  it('MAX_SUBTASK combines best subtasks', () => {
    expect(ioiTaskScore('MAX_SUBTASK', [s1, s2]).totalCenti).toBe(10000);
  });
  it('BEST_SUBMISSION takes best total', () => {
    expect(ioiTaskScore('BEST_SUBMISSION', [s1, s2]).totalCenti).toBe(6000);
  });
  it('no submissions = 0', () => {
    expect(ioiTaskScore('MAX_SUBTASK', []).totalCenti).toBe(0);
  });
});

describe('ICPC', () => {
  const start = Date.UTC(2026, 0, 1, 9, 0, 0);
  const at = (min: number, sec = 0) => start + min * 60_000 + sec * 1000;
  const opts = { startMs: start, penaltyPerReject: 20 };
  const sub = (id: string, t: number, outcome: IcpcSubmission['outcome']): IcpcSubmission => ({ id, submittedAtMs: t, outcome });

  it('counts rejected attempts before first AC', () => {
    const s = icpcProblemState([sub('1', at(10), 'REJECTED'), sub('2', at(25, 59), 'AC'), sub('3', at(30), 'REJECTED')], opts);
    expect(s).toMatchObject({ solved: true, rejected: 1, solveMinute: 25, penaltyMinutes: 45 });
  });

  it('ignores compile and system errors by default', () => {
    const s = icpcProblemState([sub('1', at(1), 'CE'), sub('2', at(2), 'SE'), sub('3', at(3), 'AC')], opts);
    expect(s.penaltyMinutes).toBe(3);
    const s2 = icpcProblemState([sub('1', at(1), 'CE'), sub('3', at(3), 'AC')], { ...opts, countCompileErrors: true });
    expect(s2.penaltyMinutes).toBe(23);
  });

  it('is independent of the order results arrive in', () => {
    const list = [sub('2', at(20), 'AC'), sub('1', at(5), 'REJECTED'), sub('3', at(7), 'REJECTED')];
    const s = icpcProblemState(list, opts);
    expect(s).toMatchObject({ solved: true, rejected: 2, penaltyMinutes: 60 });
    expect(icpcProblemState([...list].reverse(), opts)).toEqual(s);
  });

  it('marks the cell pending when an earlier submission is not judged yet', () => {
    const s = icpcProblemState([sub('1', at(5), 'PENDING'), sub('2', at(6), 'AC')], opts);
    expect(s.solved).toBe(false);
    expect(s.pending).toBe(true);
    const s2 = icpcProblemState([sub('1', at(5), 'AC'), sub('2', at(6), 'PENDING')], opts);
    expect(s2.solved).toBe(true);
    expect(s2.pending).toBe(false);
  });

  it('ranks by solved, penalty, last AC with shared ranks', () => {
    const rows = [
      { name: 'A', t: { solved: 2, penalty: 100, lastAcAtMs: 5 } },
      { name: 'B', t: { solved: 3, penalty: 300, lastAcAtMs: 9 } },
      { name: 'C', t: { solved: 2, penalty: 100, lastAcAtMs: 5 } },
      { name: 'D', t: { solved: 2, penalty: 90, lastAcAtMs: 7 } },
    ];
    const ranked = assignRanks(rows, (a, b) => compareIcpcTotals(a.t, b.t), (a, b) => a.name.localeCompare(b.name));
    expect(ranked.map((r) => `${r.row.name}${r.rank}`)).toEqual(['B1', 'D2', 'A3', 'C3']);
  });

  it('totals only solved problems', () => {
    const cells = [
      icpcProblemState([sub('1', at(10), 'AC')], opts),
      icpcProblemState([sub('2', at(10), 'REJECTED')], opts),
    ];
    expect(icpcTotals(cells)).toEqual({ solved: 1, penalty: 10, lastAcAtMs: at(10) });
  });
});
