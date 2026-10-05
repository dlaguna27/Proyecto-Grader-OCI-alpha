import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { tokenEquals } from '../auth.js';
import { blobExists, readBlob, SHA_RE } from '../storage.js';
import { HttpError } from '../util.js';

/** Worker-only endpoints. Not routed by the reverse proxy; reachable only on the internal Docker network. */
export async function internalRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req) => {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!config.workerToken || !tokenEquals(token, config.workerToken)) throw new HttpError(401, 'Bad worker token');
  });
  app.get<{ Params: { sha: string } }>('/internal/files/:sha', async (req, reply) => {
    const { sha } = req.params;
    if (!SHA_RE.test(sha) || !(await blobExists(sha))) throw new HttpError(404, 'No such file');
    reply.type('application/octet-stream');
    return reply.send(readBlob(sha));
  });
}
