import type { IncomingMessage, ServerResponse } from 'node:http';

const PONS_API = 'https://ponsfamily.com/api/launches';
const DEX_API = 'https://api.dexscreener.com/tokens/v1/robinhood/';

let cachedPons: { items: any[]; asOf: number } | null = null;
let inflightPons: Promise<{ items: any[]; asOf: number }> | null = null;

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'SNIPETECH/1.0' },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(id);
  }
}

async function fetchPages(extraQuery: string, maxPages: number): Promise<any[]> {
  const items: any[] = [];
  let cursor = '0';
  for (let i = 0; i < maxPages; i++) {
    const sep = extraQuery ? `${extraQuery}&` : '';
    const d = await fetchJson(`${PONS_API}?${sep}limit=40&cursor=${encodeURIComponent(cursor)}`).catch(() => null);
    if (!d || !Array.isArray(d.items) || !d.items.length) break;
    items.push(...d.items);
    if (d.nextCursor == null || String(d.nextCursor) === cursor) break;
    cursor = String(d.nextCursor);
  }
  return items;
}

export async function getAggregatedPons(): Promise<{ items: any[]; asOf: number }> {
  if (cachedPons && Date.now() - cachedPons.asOf * 1000 < 15000) {
    return cachedPons;
  }
  if (inflightPons) return inflightPons;

  inflightPons = (async () => {
    const map = new Map<string, any>();

    // Parallel fetch: top launches, curve tokens, new tokens, volume tokens, and graduated pages
    const batches = await Promise.allSettled([
      fetchPages('', 8),
      fetchPages('stage=curve', 3),
      fetchPages('sort=new', 3),
      fetchPages('sort=volume', 3),
      fetchPages('stage=graduated', 6),
    ]);

    for (const res of batches) {
      if (res.status !== 'fulfilled') continue;
      for (const item of res.value) {
        if (!item?.address) continue;
        const key = String(item.address).toLowerCase();
        if (!map.has(key)) map.set(key, item);
      }
    }

    const items = Array.from(map.values());

    // Enrich top graduated tokens with DexScreener 24h price change
    const gradAddrs = items
      .filter((x) => x.stage === 'graduated')
      .sort((a, b) => (b.volumeUsd || 0) - (a.volumeUsd || 0))
      .slice(0, 90)
      .map((x) => String(x.address).toLowerCase());

    const dsMap = new Map<string, number>();
    await Promise.allSettled(
      [0, 30, 60].map(async (offset) => {
        const chunk = gradAddrs.slice(offset, offset + 30);
        if (!chunk.length) return;
        const pairs = await fetchJson(`${DEX_API}${chunk.join(',')}`, 5000).catch(() => null);
        if (!Array.isArray(pairs)) return;
        for (const p of pairs) {
          const addr = p?.baseToken?.address?.toLowerCase();
          const h24 = p?.priceChange?.h24;
          if (addr && typeof h24 === 'number' && Number.isFinite(h24) && !dsMap.has(addr)) {
            dsMap.set(addr, h24 / 100);
          }
        }
      })
    );

    for (const item of items) {
      const key = String(item.address).toLowerCase();
      if (item.change24h == null && dsMap.has(key)) {
        item.change24h = dsMap.get(key);
      }
    }

    const result = { items, asOf: Math.floor(Date.now() / 1000) };
    if (items.length > 0) cachedPons = result;
    return result;
  })().finally(() => {
    inflightPons = null;
  });

  return inflightPons;
}

export async function handlePons(res: ServerResponse) {
  try {
    const data = await getAggregatedPons();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=12, stale-while-revalidate=30');
    res.end(JSON.stringify(data));
  } catch (err: any) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Upstream unavailable', items: [] }));
  }
}

export async function handlePapi(addr: string, rawQuery: string, res: ServerResponse) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid address' }));
    return;
  }
  const qs = rawQuery ? `?${rawQuery}` : '';
  try {
    const r = await fetch(`${PONS_API}/${addr.toLowerCase()}${qs}`, {
      headers: { accept: 'application/json', 'user-agent': 'SNIPETECH/1.0' },
    });
    const text = await r.text();
    res.statusCode = r.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=8, stale-while-revalidate=20');
    res.end(text);
  } catch (err: any) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Upstream unavailable' }));
  }
}

export async function handlePsearch(q: string, limit: string, res: ServerResponse) {
  try {
    const url = `${PONS_API}?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit || '8')}`;
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'SNIPETECH/1.0' },
    });
    const text = await r.text();
    res.statusCode = r.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
    res.end(text);
  } catch (err: any) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Search unavailable', items: [] }));
  }
}

export async function handleRelay(
  ep: string,
  requestId: string,
  method: string,
  body: any,
  res: ServerResponse
) {
  try {
    let target = '';
    const init: RequestInit = {
      method: method === 'POST' ? 'POST' : 'GET',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
    };
    if (ep === 'chains') {
      target = 'https://api.relay.link/chains';
    } else if (ep === 'quote') {
      target = 'https://api.relay.link/quote';
      init.method = 'POST';
      init.body = typeof body === 'string' ? body : JSON.stringify(body || {});
    } else if (ep === 'status') {
      target = `https://api.relay.link/intents/status/v2?requestId=${encodeURIComponent(requestId)}`;
    } else {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid Relay endpoint' }));
      return;
    }
    const r = await fetch(target, init);
    const text = await r.text();
    res.statusCode = r.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(text);
  } catch (err: any) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Relay unavailable' }));
  }
}

export async function handleImg(src: string, res: ServerResponse) {
  if (!src) {
    res.statusCode = 400;
    res.end('Missing src');
    return;
  }
  let target = src.trim();
  if (target.startsWith('ipfs://')) {
    const cid = target.replace(/^ipfs:\/\/(?:ipfs\/)?/, '');
    target = `https://dbk-vercel.vercel.app/api/ipfs/content/${cid}`;
  }
  if (!/^https?:\/\//i.test(target)) {
    res.statusCode = 400;
    res.end('Invalid URL');
    return;
  }
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 7000);
    const r = await fetch(target, {
      headers: { 'user-agent': 'SNIPETECH/1.0' },
      signal: ctrl.signal,
    });
    clearTimeout(id);
    if (!r.ok) {
      res.statusCode = r.status;
      res.end('Upstream error');
      return;
    }
    const ct = r.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await r.arrayBuffer());
    res.statusCode = 200;
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.end(buf);
  } catch {
    res.statusCode = 502;
    res.end('Image fetch failed');
  }
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
