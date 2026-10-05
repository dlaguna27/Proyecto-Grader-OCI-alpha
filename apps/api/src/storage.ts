import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { config } from './config.js';
import { prisma } from './db.js';

/** Content-addressed blob store: every file is stored once under its SHA-256. */
const root = () => path.join(config.dataDir, 'files');
const tmp = () => path.join(config.dataDir, 'tmp');

export const SHA_RE = /^[0-9a-f]{64}$/;

export function blobPath(sha: string): string {
  if (!SHA_RE.test(sha)) throw new Error('bad sha');
  return path.join(root(), sha.slice(0, 2), sha);
}

export async function initStorage(): Promise<void> {
  await fs.mkdir(root(), { recursive: true });
  await fs.mkdir(tmp(), { recursive: true });
}

async function commit(tmpPath: string, sha: string, size: number): Promise<string> {
  const dest = blobPath(sha);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.access(dest);
    await fs.rm(tmpPath, { force: true });
  } catch {
    await fs.rename(tmpPath, dest);
  }
  await prisma.file.upsert({ where: { sha }, create: { sha, size }, update: {} });
  return sha;
}

export async function putBuffer(data: Buffer | string): Promise<{ sha: string; size: number }> {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  const sha = createHash('sha256').update(buf).digest('hex');
  const t = path.join(tmp(), randomBytes(12).toString('hex'));
  await fs.writeFile(t, buf);
  await commit(t, sha, buf.length);
  return { sha, size: buf.length };
}

/** Streams into the store, enforcing `maxBytes`. */
export async function putStream(stream: Readable, maxBytes: number): Promise<{ sha: string; size: number }> {
  const t = path.join(tmp(), randomBytes(12).toString('hex'));
  const hash = createHash('sha256');
  let size = 0;
  try {
    await pipeline(
      stream,
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > maxBytes) throw new TooLargeError(maxBytes);
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(t),
    );
  } catch (e) {
    await fs.rm(t, { force: true });
    throw e;
  }
  const sha = hash.digest('hex');
  await commit(t, sha, size);
  return { sha, size };
}

export function readBlob(sha: string): Readable {
  return createReadStream(blobPath(sha));
}

export async function readBlobText(sha: string, maxBytes = 1024 * 1024): Promise<string> {
  const fh = await fs.open(blobPath(sha), 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } finally {
    await fh.close();
  }
}

export async function blobExists(sha: string): Promise<boolean> {
  try {
    await fs.access(blobPath(sha));
    return true;
  } catch {
    return false;
  }
}

export class TooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`File exceeds the ${Math.round(limit / 1024)} KiB limit`);
  }
}

export function tmpPath(): string {
  return path.join(tmp(), randomBytes(12).toString('hex'));
}
