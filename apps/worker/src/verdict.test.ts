import { describe, expect, it } from 'vitest';
import { checkerVerdict, classifyRun, interactiveVerdict, parsePoints, type RunResult } from './verdict.js';

const run = (over: Partial<RunResult>): RunResult => ({
  status: 'OK', exitCode: 0, exitSig: null, timeMs: 10, wallMs: 10, memoryKb: 1000, message: '', ...over,
});

describe('classifyRun', () => {
  it('detects statuses from isolate meta', () => {
    expect(classifyRun({ time: '0.5', 'cg-mem': '2048', exitcode: '0' }, 262144)).toMatchObject({ status: 'OK', timeMs: 500, memoryKb: 2048 });
    expect(classifyRun({ status: 'TO', message: 'Time limit exceeded' }, 0).status).toBe('TLE');
    expect(classifyRun({ status: 'TO', message: 'Time limit exceeded (wall clock)' }, 0).status).toBe('WALL');
    expect(classifyRun({ status: 'SG', exitsig: '9', 'cg-oom-killed': '1' }, 0).status).toBe('MLE');
    expect(classifyRun({ status: 'SG', exitsig: '11', 'cg-mem': '100' }, 262144).status).toBe('SIG');
    expect(classifyRun({ status: 'SG', exitsig: '6', 'cg-mem': '262000' }, 262144).status).toBe('MLE');
    expect(classifyRun({ status: 'RE', exitcode: '1' }, 0).status).toBe('RE');
    expect(classifyRun({ status: 'XX', message: 'boom' }, 0).status).toBe('SE');
  });
});

describe('checkerVerdict', () => {
  it('maps testlib exit codes', () => {
    expect(checkerVerdict(run({}), 'ok').verdict).toBe('AC');
    expect(checkerVerdict(run({ status: 'RE', exitCode: 1 }), 'wrong').verdict).toBe('WA');
    expect(checkerVerdict(run({ status: 'RE', exitCode: 2 }), 'pe').verdict).toBe('WA');
    expect(checkerVerdict(run({ status: 'RE', exitCode: 3 }), 'fail').verdict).toBe('SE');
    expect(checkerVerdict(run({ status: 'RE', exitCode: 7 }), 'points 0.25 meh')).toMatchObject({ verdict: 'PA', fractionPpm: 250000 });
    expect(checkerVerdict(run({ status: 'RE', exitCode: 7 }), 'points 1')).toMatchObject({ verdict: 'AC' });
    expect(checkerVerdict(run({ status: 'RE', exitCode: 7 }), 'points 7').fractionPpm).toBe(1_000_000);
    expect(checkerVerdict(run({ status: 'TLE' }), '').verdict).toBe('SE');
  });
  it('parses points', () => {
    expect(parsePoints('points 0.5 used 31 queries')).toBe(0.5);
    expect(parsePoints('nothing')).toBeNull();
  });
});

describe('interactiveVerdict', () => {
  const iOk = run({});
  const iWa = run({ status: 'RE', exitCode: 1 });
  it('accepts when both finish cleanly', () => {
    expect(interactiveVerdict(run({}), iOk, 'ok').verdict).toBe('AC');
  });
  it('interactor sandbox error is a system error, never the contestant fault', () => {
    expect(interactiveVerdict(run({ status: 'TLE' }), run({ status: 'SE' }), '').verdict).toBe('SE');
  });
  it('contestant resource limits win', () => {
    expect(interactiveVerdict(run({ status: 'TLE' }), iWa, '').verdict).toBe('TLE');
    expect(interactiveVerdict(run({ status: 'MLE' }), iOk, '').verdict).toBe('MLE');
  });
  it('contestant crash beats the WA the interactor reports after seeing EOF', () => {
    expect(interactiveVerdict(run({ status: 'RE', exitCode: 1 }), iWa, 'wrong').verdict).toBe('RE');
    expect(interactiveVerdict(run({ status: 'SIG', exitSig: 11 }), iWa, 'wrong').verdict).toBe('RE');
    expect(interactiveVerdict(run({ status: 'WALL' }), iWa, 'wrong').verdict).toBe('TLE');
  });
  it('SIGPIPE on contestant keeps the interactor verdict', () => {
    expect(interactiveVerdict(run({ status: 'SIG', exitSig: 13 }), iWa, 'wrong').verdict).toBe('WA');
  });
  it('contestant crash with accepting interactor is RE', () => {
    expect(interactiveVerdict(run({ status: 'SIG', exitSig: 11 }), iOk, '').verdict).toBe('RE');
  });
  it('SIGPIPE on contestant with accepting interactor is AC', () => {
    expect(interactiveVerdict(run({ status: 'SIG', exitSig: 13 }), iOk, '').verdict).toBe('AC');
  });
  it('deadlock is reported as idleness TLE', () => {
    const v = interactiveVerdict(run({ status: 'WALL' }), run({ status: 'WALL' }), '');
    expect(v.verdict).toBe('TLE');
    expect(v.message).toMatch(/Idleness/);
  });
  it('interactor killed by SIGPIPE means the solution quit early', () => {
    expect(interactiveVerdict(run({}), run({ status: 'SIG', exitSig: 13 }), '').verdict).toBe('WA');
  });
  it('interactor FAIL or crash is a system error', () => {
    expect(interactiveVerdict(run({}), run({ status: 'RE', exitCode: 3 }), 'FAIL bad').verdict).toBe('SE');
    expect(interactiveVerdict(run({}), run({ status: 'SIG', exitSig: 11 }), '').verdict).toBe('SE');
  });
  it('partial points from interactor', () => {
    expect(interactiveVerdict(run({}), run({ status: 'RE', exitCode: 7 }), 'points 0.5 31 queries')).toMatchObject({ verdict: 'PA', fractionPpm: 500000 });
  });
});
