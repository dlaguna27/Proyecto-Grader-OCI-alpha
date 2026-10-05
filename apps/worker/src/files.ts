import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface FileSource {
  /** Returns a local path to the file with the given SHA-256. */
  get(sha: string): Promise<string>;
}

const SHA_RE = /^[a-f0-9]{64}$/;

/** Content-addressed cache backed by the API's internal file endpoint. */
export class HttpFileCache implements FileSource {
  private inflight = new Map<string, Promise<string>>();

  constructor(
    private dir: string,
    private baseUrl: string,
    private token: string,
  ) {}

  async get(sha: string): Promise<string> {
    if (!SHA_RE.test(sha)) throw new Error(`Invalid file id ${sha}`);
    const dest = path.join(this.dir, sha.slice(0, 2), sha);
    try {
      await fs.access(dest);
      return dest;
    } catch {
      /* not cached */
    }
    let p = this.inflight.get(sha);
    if (!p) {
      p = this.download(sha, dest).finally(() => this.inflight.delete(sha));
      this.inflight.set(sha, p);
    }
    return p;
  }

  private async download(sha: string, dest: string): Promise<string> {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const res = await fetch(`${this.baseUrl}/internal/files/${sha}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    if (!res.ok || !res.body) throw new Error(`Fetching file ${sha} failed: HTTP ${res.status}`);
    const tmp = `${dest}.${randomUUID()}.tmp`;
    const hash = createHash('sha256');
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (chunk: Buffer) => hash.update(chunk));
    await pipeline(body, createWriteStream(tmp));
    const got = hash.digest('hex');
    if (got !== sha) {
      await fs.rm(tmp, { force: true });
      throw new Error(`Checksum mismatch for ${sha} (got ${got})`);
    }
    await fs.rename(tmp, dest);
    return dest;
  }
}

/** Directory where files are stored under their SHA-256 (used by the self-test). */
export class DirFileSource implements FileSource {
  constructor(private dir: string) {}

  async put(content: string | Buffer): Promise<string> {
    const sha = createHash('sha256').update(content).digest('hex');
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, sha), content);
    return sha;
  }

  async get(sha: string): Promise<string> {
    if (!SHA_RE.test(sha)) throw new Error(`Invalid file id ${sha}`);
    const p = path.join(this.dir, sha);
    await fs.access(p);
    return p;
  }
}
