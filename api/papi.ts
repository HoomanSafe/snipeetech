import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePapi } from '../src/server/proxy.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  const addr = url.searchParams.get('addr') || '';
  url.searchParams.delete('addr');
  await handlePapi(addr, url.searchParams.toString(), res);
}
