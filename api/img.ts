import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleImg } from '../src/server/proxy.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || '/', 'http://localhost');
  await handleImg(url.searchParams.get('src') || '', res);
}
