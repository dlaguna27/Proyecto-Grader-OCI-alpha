import { describe, expect, it } from 'vitest';

process.env.WORKER_TOKEN ??= 'test';
process.env.ADMIN_PASSWORD ??= 'test';
const { pairTests } = await import('./zip.js');

const f = (p: string, size = 1) => ({ path: p, name: p.split('/').pop()!, size, sha: `sha-${p}` });

describe('pairTests', () => {
  it('pairs .in with .out/.ans across folders, samples first, natural order', () => {
    const { tests, warnings } = pairTests(
      [f('t/10.in'), f('t/10.out'), f('t/2.in'), f('t/2.ans'), f('sample1.in'), f('sample1.out'), f('readme.txt')],
      true,
    );
    expect(tests.map((t) => [t.name, t.isSample, t.answerSha])).toEqual([
      ['sample1', true, 'sha-sample1.out'],
      ['2', false, 'sha-t/2.ans'],
      ['10', false, 'sha-t/10.out'],
    ]);
    expect(warnings).toEqual(['Ignored readme.txt (expected .in, .out or .ans)']);
  });

  it('requires answers unless the problem is output-only/interactive', () => {
    expect(() => pairTests([f('1.in')], true)).toThrow(/no \.out/);
    expect(pairTests([f('1.in')], false).tests[0]!.answerSha).toBeNull();
  });

  it('rejects duplicate names and empty archives', () => {
    expect(() => pairTests([f('a/1.in'), f('b/1.in')], true)).toThrow(/Duplicate/);
    expect(() => pairTests([f('1.out')], true)).toThrow(/No tests found/);
  });

  it('warns about orphan answers', () => {
    expect(pairTests([f('1.in'), f('1.out'), f('2.out')], true).warnings).toEqual([
      'Answer file for "2" has no matching .in file',
    ]);
  });
});
