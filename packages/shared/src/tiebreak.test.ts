import { describe, expect, it } from 'vitest';
import { compareIoiTotals, ioiTaskScoreReached } from './scoring/ioi.js';
import { assignRanks } from './scoring/rank.js';
import { rankRevealCells } from './scoring/reveal.js';

const sub = (atMs: number, subtasks: [string, number][]) => ({
  atMs,
  score: { totalCenti: subtasks.reduce((a, [, s]) => a + s, 0), subtasks: subtasks.map(([id, scoreCenti]) => ({ id, scoreCenti })) },
});

describe('ioiTaskScoreReached', () => {
  it('uses the submission that last raised the task score', () => {
    const r = ioiTaskScoreReached('MAX_SUBTASK', [sub(10, [['a', 3000], ['b', 0]]), sub(20, [['a', 0], ['b', 7000]]), sub(30, [['a', 3000], ['b', 7000]])]);
    expect(r).toEqual({ totalCenti: 10000, reachedAtMs: 20 });
  });
  it('BEST_SUBMISSION ignores combinations across submissions', () => {
    const r = ioiTaskScoreReached('BEST_SUBMISSION', [sub(10, [['a', 3000], ['b', 0]]), sub(20, [['a', 0], ['b', 7000]]), sub(30, [['a', 3000], ['b', 7000]])]);
    expect(r).toEqual({ totalCenti: 10000, reachedAtMs: 30 });
  });
  it('is null at zero points', () => {
    expect(ioiTaskScoreReached('MAX_SUBTASK', [sub(5, [['a', 0]])])).toEqual({ totalCenti: 0, reachedAtMs: null });
  });
});

describe('IOI ranking with time tie-break', () => {
  const rows = [
    { name: 'Zeta', totalCenti: 5000, reachedAtMs: 100 },
    { name: 'Beta', totalCenti: 5000, reachedAtMs: 200 },
    { name: 'Alfa', totalCenti: 5000, reachedAtMs: 200 },
    { name: 'Omega', totalCenti: 9000, reachedAtMs: 900 },
    { name: 'Cero2', totalCenti: 0, reachedAtMs: null },
    { name: 'Cero1', totalCenti: 0, reachedAtMs: null },
  ];
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  it('TIME gives distinct ranks: earlier first, then name', () => {
    const r = assignRanks(rows, (a, b) => compareIoiTotals(a, b, 'TIME'), byName, true);
    expect(r.map((x) => [x.row.name, x.rank])).toEqual([['Omega', 1], ['Zeta', 2], ['Alfa', 3], ['Beta', 4], ['Cero1', 5], ['Cero2', 6]]);
  });
  it('SHARED keeps competition ranks', () => {
    const r = assignRanks(rows, (a, b) => compareIoiTotals(a, b, 'SHARED'), byName);
    expect(r.map((x) => [x.row.name, x.rank])).toEqual([['Omega', 1], ['Alfa', 2], ['Beta', 2], ['Zeta', 2], ['Cero1', 5], ['Cero2', 5]]);
  });
  it('reveal ranking uses the latest reaching time across tasks', () => {
    const cell = (scoreCenti: number, reachedAtMs: number | null) => ({ scoreCenti, attempts: 1, pending: 0, reachedAtMs });
    const teams = [{ userId: 'u1', displayName: 'A' }, { userId: 'u2', displayName: 'B' }];
    const cells = { u1: { p: cell(5000, 50), q: cell(5000, 400) }, u2: { p: cell(10000, 300), q: cell(0, null) } };
    expect(rankRevealCells('IOI', teams, cells, 'TIME')).toEqual([{ userId: 'u2', rank: 1 }, { userId: 'u1', rank: 2 }]);
    expect(rankRevealCells('IOI', teams, cells, 'SHARED')).toEqual([{ userId: 'u1', rank: 1 }, { userId: 'u2', rank: 1 }]);
  });
});
