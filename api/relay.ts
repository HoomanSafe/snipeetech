import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRelay, readBody } from '../src/server/proxy.ts';

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  const ep = url.searchParams.get('ep') || '';
  const requestId = url.searchParams.get('requestId') || '';
  const body = req.method === 'POST' ? (req.body ?? (await readBody(req))) : undefined;
  await handleRelay(ep, requestId, req.method || 'GET', body, res);
}
