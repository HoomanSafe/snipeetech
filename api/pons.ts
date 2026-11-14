import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePons } from '../src/server/proxy.ts';

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  await handlePons(res);
}
