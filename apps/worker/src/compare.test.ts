import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareOutputs } from './compare.js';

const dir = mkdtempSync(path.join(os.tmpdir(), 'cmp-'));
let n = 0;
const file = (s: string) => {
  const p = path.join(dir, `f${n++}`);
  writeFileSync(p, s);
  return p;
};

describe('compareOutputs', () => {
  it('ignores whitespace and CRLF', async () => {
    expect((await compareOutputs(file('1 2\r\n3\r\n'), file('1  2\n3'), null)).verdict).toBe('AC');
  });
  it('detects mismatch, missing and extra tokens without leaking the answer', async () => {
    const r = await compareOutputs(file('1 2 4'), file('1 2 3'), null);
    expect(r).toMatchObject({ verdict: 'WA', message: 'Mismatch at token 3' });
    expect((await compareOutputs(file('1 2'), file('1 2 3'), null)).message).toMatch(/ended early/);
    expect((await compareOutputs(file('1 2 3 4'), file('1 2 3'), null)).message).toMatch(/Extra/);
  });
  it('float tolerance', async () => {
    expect((await compareOutputs(file('0.3333334'), file('0.333333333'), 1e-6)).verdict).toBe('AC');
    expect((await compareOutputs(file('0.334'), file('0.333333333'), 1e-6)).verdict).toBe('WA');
    expect((await compareOutputs(file('1000000.5'), file('1000000.0'), 1e-6)).verdict).toBe('AC');
    expect((await compareOutputs(file('YES 1.0'), file('NO 1.0'), 1e-6)).verdict).toBe('WA');
  });
});
