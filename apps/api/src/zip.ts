import path from 'node:path';
import yauzl from 'yauzl';
import type { Readable } from 'node:stream';
import { putStream } from './storage.js';
import { HttpError, naturalCompare } from './util.js';

export interface ZipFile {
  /** Path inside the archive, normalized with forward slashes. */
  path: string;
  name: string;
  size: number;
  sha: string;
}

const MAX_ENTRIES = 10_000;

function open(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true, strictFileNames: false }, (err, zf) =>
      err || !zf ? reject(new HttpError(400, `Not a valid zip file: ${err?.message ?? 'unknown error'}`)) : resolve(zf),
    ),
  );
}

/** Extracts every regular file into the blob store. yauzl rejects absolute and `..` paths. */
export async function extractZip(file: string, maxTotalBytes: number, maxFileBytes: number): Promise<ZipFile[]> {
  const zf = await open(file);
  const out: ZipFile[] = [];
  let total = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zf.on('error', reject);
      zf.on('end', () => resolve());
      zf.on('entry', (entry: yauzl.Entry) => {
        const p = entry.fileName.replace(/\\/g, '/');
        const base = path.posix.basename(p);
        const skip = p.endsWith('/') || p.startsWith('__MACOSX/') || base.startsWith('.') || base === 'Thumbs.db';
        if (skip) return zf.readEntry();
        if (out.length >= MAX_ENTRIES) return reject(new HttpError(400, `Zip has more than ${MAX_ENTRIES} files`));
        total += entry.uncompressedSize;
        if (total > maxTotalBytes) return reject(new HttpError(400, 'Zip contents are too large'));
        zf.openReadStream(entry, (err, stream) => {
          if (err || !stream) return reject(err ?? new Error('zip read failed'));
          putStream(stream as Readable, maxFileBytes)
            .then(({ sha, size }) => {
              out.push({ path: p, name: base, size, sha });
              zf.readEntry();
            })
            .catch(reject);
        });
      });
      zf.readEntry();
    });
  } finally {
    zf.close();
  }
  return out;
}

export interface ParsedTest {
  name: string;
  inputSha: string;
  answerSha: string | null;
  inputSize: number;
  isSample: boolean;
}

const INPUT_EXT = new Set(['.in']);
const ANSWER_EXT = new Set(['.out', '.ans', '.sol']);

/**
 * Pairs `NAME.in` with `NAME.out` / `NAME.ans`. Folders are allowed (names are taken from the file
 * name only). Tests whose name contains "sample" or "example" are flagged as samples.
 */
export function pairTests(files: ZipFile[], requireAnswers: boolean): { tests: ParsedTest[]; warnings: string[] } {
  const warnings: string[] = [];
  const inputs = new Map<string, ZipFile>();
  const answers = new Map<string, ZipFile>();
  for (const f of files) {
    const ext = path.posix.extname(f.name).toLowerCase();
    const stem = f.name.slice(0, f.name.length - ext.length);
    const target = INPUT_EXT.has(ext) ? inputs : ANSWER_EXT.has(ext) ? answers : null;
    if (!target) {
      warnings.push(`Ignored ${f.path} (expected .in, .out or .ans)`);
      continue;
    }
    if (target.has(stem)) throw new HttpError(400, `Duplicate test file name "${f.name}" (${target.get(stem)!.path} and ${f.path})`);
    target.set(stem, f);
  }
  const tests: ParsedTest[] = [];
  for (const [name, input] of inputs) {
    const answer = answers.get(name) ?? null;
    if (!answer && requireAnswers) throw new HttpError(400, `Test "${name}" has no .out/.ans file`);
    tests.push({ name, inputSha: input.sha, answerSha: answer?.sha ?? null, inputSize: input.size, isSample: /sample|example/i.test(name) });
  }
  for (const name of answers.keys()) if (!inputs.has(name)) warnings.push(`Answer file for "${name}" has no matching .in file`);
  if (tests.length === 0) throw new HttpError(400, 'No tests found: the zip must contain NAME.in files (with NAME.out answers)');
  tests.sort((a, b) => Number(b.isSample) - Number(a.isSample) || naturalCompare(a.name, b.name));
  return { tests, warnings };
}
