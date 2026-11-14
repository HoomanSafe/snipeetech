export interface TokenItem {
  address: string;
  name: string;
  symbol: string;
  artwork: string | null;
  priceUsd: number | null;
  priceQuote: number | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  ch24: number | null;
  liquidityUsd: number | null;
  tx24: number | null;
  tradeCount: number | null;
  stage: string;
  protocol: string;
  progress: number | null;
  graduated: boolean;
  createdAt: number | null;
  lastTradeAt: number | null;
  graduatedAt: number | null;
  quote: string | null;
  quoteUsd: number | null;
  raisedQuote: number | null;
  thresholdQuote: number | null;
  pool: string | null;
  poolId: string | null;
  curve: string | null;
  factory: string | null;
  deployer: string | null;
  supply: number;
  creatorTaxBps: number | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  description: string;
  official: boolean;
  trendRank?: number;
  socials?: {
    website: string | null;
    x: string | null;
    telegram: string | null;
  };
}

export interface DexPair {
  url?: string;
  pairAddress?: string;
  baseToken?: { address?: string };
  priceChange?: Record<string, number>;
  volume?: Record<string, number>;
  liquidity?: { usd?: number };
  fdv?: number;
  txns?: { h24?: { buys?: number; sells?: number } };
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeRow {
  kind: 'buy' | 'sell' | string;
  venue: string;
  to_token_address: string;
  from_token_amount: number;
  to_token_amount: number;
  price_to_in_usd: number;
  price_from_in_usd: number;
  block_timestamp: string;
  volume_in_usd: number;
  tx_from_address: string;
  tx_hash: string;
}

const cache = new Map<string, { p?: Promise<any>; v?: any; t: number }>();

async function getJSON(url: string, ttl = 0): Promise<any> {
  const hit = cache.get(url);
  if (hit && (hit.p || Date.now() - hit.t < ttl)) {
    return hit.p || hit.v;
  }
  const once = () =>
    fetch(url, { headers: { accept: 'application/json' } }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return r.json();
    });
  const p = once().catch(() => new Promise((ok) => setTimeout(ok, 900)).then(once));
  cache.set(url, { p, t: Date.now() });
  try {
    const v = await p;
    cache.set(url, { v, t: Date.now() });
    return v;
  } catch (e) {
    cache.delete(url);
    throw e;
  }
}

const n = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const ADDR = /^0x[0-9a-fA-F]{40}$/;

export function normalizeToken(x: any): TokenItem {
  const grad = x.stage === 'graduated';
  const lastTradeAt = n(x.lastTradeAt);
  return {
    address: String(x.address || '').toLowerCase(),
    name: x.name || x.symbol || '',
    symbol: x.symbol || '',
    artwork: x.artwork || null,
    priceUsd: n(x.priceUsd),
    priceQuote: n(x.priceQuote),
    marketCapUsd: n(x.marketCapUsd),
    volumeUsd: n(x.volumeUsd),
    ch24: n(x.change24h) ?? (lastTradeAt && lastTradeAt < Date.now() / 1000 - 86400 ? 0 : null),
    liquidityUsd: null,
    tx24: null,
    tradeCount: n(x.tradeCount),
    stage: x.stage || 'curve',
    protocol: x.protocol || 'v2',
    progress: grad ? 1 : n(x.progress),
    graduated: grad,
    createdAt: n(x.createdAt),
    lastTradeAt,
    graduatedAt: n(x.graduatedAt),
    quote: x.quote?.symbol || null,
    quoteUsd: n(x.quoteUsd),
    raisedQuote: n(x.raisedQuote),
    thresholdQuote: n(x.thresholdQuote),
    pool: x.pool || null,
    poolId: x.poolId || null,
    curve: x.curve || null,
    factory: x.factory || null,
    deployer: x.deployer || null,
    supply: n(x.totalSupply) || 1e9,
    creatorTaxBps: n(x.creatorTaxBps),
    website: x.socials?.website || null,
    twitter: x.socials?.twitter || null,
    telegram: x.socials?.telegram || null,
    description: x.description || '',
    official: false,
  };
}

export async function fetchAllTokens(ttl = 10000): Promise<{ list: TokenItem[]; generatedAt: number | null }> {
  const d = await getJSON('/api/pons', ttl);
  const list: TokenItem[] = (d.items || []).map(normalizeToken);
  list
    .slice()
    .sort((a, b) => (b.volumeUsd || 0) - (a.volumeUsd || 0))
    .forEach((L, i) => {
      L.trendRank = i + 1;
    });
  return { list, generatedAt: n(d.asOf) };
}

const rawLaunch = (a: string) => getJSON(`/papi/${a}`, 10000);

export async function fetchOneToken(a: string): Promise<TokenItem | null> {
  if (!ADDR.test(a)) return null;
  const d = await rawLaunch(a);
  return d?.address ? normalizeToken(d) : null;
}

export async function fetchSnapshot(a: string): Promise<TokenItem | null> {
  const L = await fetchOneToken(a);
  if (!L) return null;
  return {
    ...L,
    socials: { website: L.website, x: L.twitter, telegram: L.telegram },
  };
}

export async function fetchLaunchInfo(a: string) {
  const L = await fetchOneToken(a);
  if (!L) return null;
  return {
    pons: true,
    creator: L.deployer,
    payoutWallet: L.deployer,
    quoteSymbol: L.quote,
    buyTaxBps: L.creatorTaxBps,
    devHoldsPct: null as number | null,
    taxSplit: null as Array<{ label: string; bps: number }> | null,
  };
}

export async function searchRemoteTokens(q: string): Promise<TokenItem[]> {
  const d = await getJSON(`/psearch?q=${encodeURIComponent(q)}&limit=8`, 30000);
  return (d.items || []).map(normalizeToken);
}

const WIN: Record<string, [string, number]> = {
  '1h': ['1m', 3600],
  '6h': ['5m', 21600],
  '1d': ['15m', 86400],
  '1w': ['1h', 604800],
  all: ['4h', Infinity],
};

export async function fetchChart(
  a: string,
  range: string,
  ttl = 10000
): Promise<{ effectiveRange: string; candles: Candle[]; unavailableReason?: string }> {
  const [iv, span] = WIN[range] || WIN['1d'];
  const [c, t] = await Promise.all([
    getJSON(`/papi/${a}?view=candles&interval=${iv}&limit=1000`, ttl),
    rawLaunch(a),
  ]);
  const q = n(t?.quoteUsd) || 0;
  const from = Date.now() / 1000 - span;
  let rows: any[] = (Array.isArray(c) ? c : c?.items || []).filter((k: any) => k.time >= from);
  if (range === 'all' && rows.length < 20) {
    const fallback = await getJSON(`/papi/${a}?view=candles&interval=15m&limit=1000`, ttl);
    rows = Array.isArray(fallback) ? fallback : fallback?.items || [];
  }
  const effectiveRange =
    range === 'all' && rows.length > 1 && rows[1].time - rows[0].time === 900 ? '15m' : iv;
  return {
    effectiveRange,
    candles: rows.map((k) => ({
      time: k.time,
      open: k.open * q,
      high: k.high * q,
      low: k.low * q,
      close: k.close * q,
      volume: (k.volumeQuote || 0) * q,
    })),
  };
}

export async function fetchTrades(a: string): Promise<TradeRow[]> {
  const [d, t] = await Promise.all([getJSON(`/papi/${a}?view=trades`, 12000), rawLaunch(a)]);
  const q = n(t?.quoteUsd) || 0;
  return (d.items || []).map((x: any) => {
    const buy = x.side === 'buy';
    return {
      kind: x.side,
      venue: x.venue === 'curve' ? 'curve' : x.venue || '',
      to_token_address: buy ? a : '',
      from_token_amount: buy ? x.quoteAmount : x.tokenAmount,
      to_token_amount: buy ? x.tokenAmount : x.quoteAmount,
      price_to_in_usd: x.price * q,
      price_from_in_usd: x.price * q,
      block_timestamp: new Date(x.timestamp * 1000).toISOString(),
      volume_in_usd: x.quoteAmount * q,
      tx_from_address: x.trader,
      tx_hash: x.txHash,
    };
  });
}

export async function fetchDexPairs(addrs: string[]): Promise<Map<string, DexPair>> {
  const out = new Map<string, DexPair>();
  const uniq = [...new Set(addrs.map((a) => a.toLowerCase()))];
  for (let i = 0; i < uniq.length; i += 30) {
    const chunk = uniq.slice(i, i + 30);
    try {
      const pairs: DexPair[] =
        (await getJSON(`https://api.dexscreener.com/tokens/v1/robinhood/${chunk.join(',')}`, 20000)) || [];
      for (const p of pairs) {
        const a = p.baseToken?.address?.toLowerCase();
        if (!a || !chunk.includes(a)) continue;
        const cur = out.get(a);
        if (!cur || (p.liquidity?.usd || 0) > (cur.liquidity?.usd || 0)) out.set(a, p);
      }
    } catch {
      // DexScreener optional enrichment
    }
  }
  return out;
}
