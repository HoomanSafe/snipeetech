import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePsearch } from '../src/server/proxy.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  await handlePsearch(url.searchParams.get('q') || '', url.searchParams.get('limit') || '8', res);
}
