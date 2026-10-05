import { promises as fs } from 'node:fs';
import { PPM } from '@noi/shared';
import type { Evaluation } from './verdict.js';

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0b || c === 0x0c;
}

function* tokens(buf: Buffer): Generator<Buffer> {
  let i = 0;
  const n = buf.length;
  while (i < n) {
    while (i < n && isSpace(buf[i])) i++;
    if (i >= n) return;
    const start = i;
    while (i < n && !isSpace(buf[i])) i++;
    yield buf.subarray(start, i);
  }
}

const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function floatEqual(a: string, b: string, eps: number): boolean {
  if (!NUMBER_RE.test(a) || !NUMBER_RE.test(b)) return a === b;
  const x = Number(a);
  const y = Number(b);
  const diff = Math.abs(x - y);
  return diff <= eps || diff <= eps * Math.abs(y);
}

/**
 * Built-in checker: compares whitespace-separated tokens, so trailing spaces and
 * CRLF vs LF never matter. With `epsilon`, numeric tokens may differ by abs/rel error.
 * Messages never reveal expected output.
 */
export async function compareOutputs(outputPath: string, answerPath: string, epsilon: number | null): Promise<Evaluation> {
  const [out, ans] = await Promise.all([fs.readFile(outputPath), fs.readFile(answerPath)]);
  const it = tokens(out);
  let idx = 0;
  for (const expected of tokens(ans)) {
    idx++;
    const got = it.next();
    if (got.done) return { verdict: 'WA', fractionPpm: 0, message: `Output ended early (token ${idx} missing)` };
    const same =
      epsilon === null ? got.value.equals(expected) : floatEqual(got.value.toString('latin1'), expected.toString('latin1'), epsilon);
    if (!same) return { verdict: 'WA', fractionPpm: 0, message: `Mismatch at token ${idx}` };
  }
  if (!it.next().done) return { verdict: 'WA', fractionPpm: 0, message: `Extra output after token ${idx}` };
  return { verdict: 'AC', fractionPpm: PPM, message: null };
}
