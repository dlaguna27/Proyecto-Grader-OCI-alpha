import { describe, expect, it } from 'vitest';
import { buildRevealSteps, rankRevealCells, type RevealIcpcCell, type RevealIoiCell, type RevealTeam } from './index.js';

const ioi = (scoreCenti: number, pending = 0): RevealIoiCell => ({ scoreCenti, attempts: 1, pending });
const icpc = (solved: boolean, rejected: number, minute: number | null, pending = 0): RevealIcpcCell => ({
  solved,
  rejected,
  penaltyMinutes: solved ? minute! + 20 * rejected : 0,
  solveMinute: solved ? minute : null,
  acElapsedMs: solved ? minute! * 60_000 : null,
  pending: pending > 0,
  pendingCount: pending,
});

describe('reveal', () => {
  const teams: RevealTeam<RevealIoiCell>[] = [
    { userId: 'a', displayName: 'A', before: { p: ioi(5000), q: ioi(0, 1) }, after: { p: ioi(5000), q: ioi(10000) } },
    { userId: 'b', displayName: 'B', before: { p: ioi(9000), q: ioi(0) }, after: { p: ioi(9000), q: ioi(0) } },
    { userId: 'c', displayName: 'C', before: { p: ioi(1000, 1), q: ioi(0) }, after: { p: ioi(2000), q: ioi(0) } },
  ];

  it('IOI resolver works bottom-up and ends at the final ranking', () => {
    const steps = buildRevealSteps('IOI', ['p', 'q'], teams, 'CURRENT_RANK');
    const last = steps.at(-1)!;
    expect(last.order).toEqual(rankRevealCells('IOI', teams, Object.fromEntries(teams.map((t) => [t.userId, t.after]))));
    expect(last.order.map((r) => r.userId)).toEqual(['a', 'b', 'c']);
    expect(last.finalized).toEqual(['c', 'b', 'a']);
    // c (last) is marked, its problem marked, then revealed, then finalized; then a (now last)
    // reveals q and climbs to first. Cells and ranks change only on reveal steps.
    expect(steps.slice(1).map((s) => s.focus)).toEqual([
      { userId: 'c', problemId: null, phase: 'team' },
      { userId: 'c', problemId: 'p', phase: 'problem' },
      { userId: 'c', problemId: 'p', phase: 'reveal' },
      { userId: 'c', problemId: null, phase: 'final' },
      { userId: 'a', problemId: null, phase: 'team' },
      { userId: 'a', problemId: 'q', phase: 'problem' },
      { userId: 'a', problemId: 'q', phase: 'reveal' },
      { userId: 'b', problemId: null, phase: 'final' },
      { userId: 'a', problemId: null, phase: 'final' },
    ]);
    for (let k = 1; k < steps.length; k++) {
      if (steps[k].focus!.phase === 'reveal') continue;
      expect(steps[k].cells).toBe(steps[k - 1].cells);
      expect(steps[k].order).toEqual(steps[k - 1].order);
    }
    expect(steps[6].order.map((r) => r.userId)).toEqual(['b', 'a', 'c']);
    expect(steps[7].order.map((r) => r.userId)).toEqual(['a', 'b', 'c']);
  });

  it('FINAL_RANK order reveals teams from final last place to the winner', () => {
    const steps = buildRevealSteps('IOI', ['p', 'q'], teams, 'FINAL_RANK');
    expect(steps.at(-1)!.finalized).toEqual(['c', 'b', 'a']);
  });

  it('ICPC ranks by solved, penalty and last AC; pending cells are revealed', () => {
    const t: RevealTeam<RevealIcpcCell>[] = [
      { userId: 'x', displayName: 'X', before: { p: icpc(true, 0, 30), q: icpc(false, 1, null, 1) }, after: { p: icpc(true, 0, 30), q: icpc(true, 1, 250) } },
      { userId: 'y', displayName: 'Y', before: { p: icpc(true, 0, 10), q: icpc(true, 0, 100) }, after: { p: icpc(true, 0, 10), q: icpc(true, 0, 100) } },
    ];
    const steps = buildRevealSteps('ICPC', ['p', 'q'], t, 'CURRENT_RANK');
    expect(steps[0].order.map((r) => r.userId)).toEqual(['y', 'x']);
    // x: 2 solved, penalty 30 + 250 + 20 = 300 > y's 110, so y stays first.
    expect(steps.at(-1)!.order).toEqual([
      { userId: 'y', rank: 1 },
      { userId: 'x', rank: 2 },
    ]);
  });

  it('ties share a rank', () => {
    const t = [
      { userId: 'a', displayName: 'A' },
      { userId: 'b', displayName: 'B' },
    ];
    expect(rankRevealCells('IOI', t, { a: { p: ioi(100) }, b: { p: ioi(100) } }).map((r) => r.rank)).toEqual([1, 1]);
  });
});
