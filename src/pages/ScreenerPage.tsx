import { useEffect, useMemo, useState } from 'react';
import { SITE_CONFIG } from '../config/siteConfig';
import { fetchDexPairs, type DexPair, type TokenItem } from '../lib/api';
import { formatAge, formatCompact, formatNum, formatPct, formatPrice, isNum } from '../lib/format';
import { TokenLogo } from '../components/TokenLogo';

interface ScreenerPageProps {
  tokens: TokenItem[];
  loading: boolean;
  err: string;
  tab: string;
  pair: string;
  q: string;
  onRefresh: () => void;
  onNavigate: (hash: string) => void;
}

const TABS = [
  { id: 'top', label: 'Top', hint: 'Highest market cap' },
  { id: 'trending', label: 'Volume', hint: 'Highest volume' },
  { id: 'new', label: 'New', hint: 'Newest launches first' },
  { id: 'gainers', label: 'Gainers', hint: 'Biggest 24h price change (tokens with 24h volume)' },
  { id: 'graduating', label: 'Near graduation', hint: 'Bonding-curve tokens closest to graduating' },
  { id: 'graduated', label: 'Graduated', hint: 'Tokens that left the bonding curve for their pool' },
];

const PAIRS: Array<[string, string]> = [
  ['all', 'All'],
  ['eth', 'ETH'],
  ['usdg', 'USDG'],
  ['stocks', 'Stocks & more'],
];

const COLS = [
  { k: 'rank', t: '#', cls: 'c-rank', sort: '' },
  { k: 'token', t: 'Token', cls: 'c-token', sort: 'name' },
  { k: 'price', t: 'Price', cls: 'num', sort: 'price' },
  { k: 'age', t: 'Age', cls: 'num hide-sm', sort: 'age' },
  { k: 'tx', t: 'Trades', cls: 'num hide-md', sort: 'tx', title: 'Total trades' },
  { k: 'vol', t: 'Volume', cls: 'num', sort: 'vol', title: '24h volume for graduated tokens, total volume for curve tokens' },
  { k: 'm5', t: '5M', cls: 'num hide-md', sort: 'm5' },
  { k: 'h1', t: '1H', cls: 'num', sort: 'h1' },
  { k: 'h6', t: '6H', cls: 'num hide-md', sort: 'h6' },
  { k: 'h24', t: '24H', cls: 'num', sort: 'h24' },
  { k: 'liq', t: 'Liquidity', cls: 'num', sort: 'liq', title: 'Pool liquidity (graduated tokens)' },
  { k: 'mcap', t: 'MCap', cls: 'num', sort: 'mcap' },
  { k: 'status', t: 'Stage', cls: 'c-status', sort: 'progress', title: 'Bonding curve progress, or graduated' },
];

const PAGE_SIZE = 100;

const pairOf = (L: TokenItem) => {
  const q = (L.quote || '').toUpperCase();
  return q === 'ETH' || q === 'WETH' ? 'eth' : q === 'USDG' ? 'usdg' : 'stocks';
};

const matchQ = (L: TokenItem, q: string) => {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    L.address.toLowerCase() === s ||
    L.symbol.toLowerCase().includes(s) ||
    L.name.toLowerCase().includes(s) ||
    (s.length >= 6 && L.address.toLowerCase().includes(s))
  );
};

export function ScreenerPage({
  tokens,
  loading,
  err,
  tab,
  pair,
  q,
  onRefresh,
  onNavigate,
}: ScreenerPageProps) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [live, setLive] = useState(true);
  const [countdown, setCountdown] = useState(20);
  const [dsMap, setDsMap] = useState<Map<string, DexPair>>(new Map());

  useEffect(() => {
    setSortKey(null);
    setShown(PAGE_SIZE);
  }, [tab, pair, q]);

  useEffect(() => {
    if (!live) return;
    let left = 20;
    setCountdown(left);
    const id = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        left = 20;
        if (!document.hidden) onRefresh();
      }
      setCountdown(left);
    }, 1000);
    return () => clearInterval(id);
  }, [live, onRefresh]);

  const metricsOf = (L: TokenItem) => {
    const ds = dsMap.get(L.address.toLowerCase());
    const ch: Record<'m5' | 'h1' | 'h6' | 'h24', number | null> = {
      m5: null,
      h1: null,
      h6: null,
      h24: L.ch24,
    };
    if (ds) {
      const pc = ds.priceChange || {};
      const v = ds.volume || {};
      for (const k of ['m5', 'h1', 'h6'] as const) {
        ch[k] = isNum(pc[k]) ? pc[k] / 100 : v[k] === 0 ? 0 : null;
      }
      if (ch.h24 == null && isNum(pc.h24)) ch.h24 = pc.h24 / 100;
    }
    const tx = isNum(L.tradeCount) ? L.tradeCount : null;
    const liq = isNum(L.liquidityUsd) ? L.liquidityUsd : ds?.liquidity?.usd ?? null;
    const vol = isNum(L.volumeUsd) ? L.volumeUsd : ds?.volume?.h24 ?? null;
    return { ds, ch, tx, liq, vol };
  };

  const sortedRows = useMemo(() => {
    let r = tokens.filter((L) => matchQ(L, q));
    if (pair !== 'all') r = r.filter((L) => pairOf(L) === pair);

    const by = (f: (L: TokenItem) => number | null) => (a: TokenItem, b: TokenItem) => {
      const x = f(a);
      const y = f(b);
      return Number(x == null) - Number(y == null) || (y ?? 0) - (x ?? 0);
    };

    switch (tab) {
      case 'top':
        r.sort(by((L) => L.marketCapUsd));
        break;
      case 'new':
        r.sort(by((L) => L.createdAt));
        break;
      case 'gainers':
        r = r.filter((L) => (L.volumeUsd || 0) > 0 && isNum(L.ch24));
        r.sort(by((L) => L.ch24));
        break;
      case 'graduating':
        r = r.filter((L) => !L.graduated);
        r.sort(by((L) => L.progress));
        break;
      case 'graduated':
        r = r.filter((L) => L.graduated);
        r.sort(by((L) => L.marketCapUsd));
        break;
      default:
        r.sort((a, b) => (a.trendRank ?? 99999) - (b.trendRank ?? 99999));
    }

    if (sortKey) {
      const getVal = (L: TokenItem): string | number | null => {
        const m = metricsOf(L);
        switch (sortKey) {
          case 'name':
            return (L.symbol || '').toLowerCase();
          case 'price':
            return L.priceUsd;
          case 'age':
            return isNum(L.createdAt) ? -L.createdAt : null;
          case 'tx':
            return m.tx;
          case 'vol':
            return m.vol;
          case 'liq':
            return m.liq;
          case 'mcap':
            return L.marketCapUsd;
          case 'm5':
          case 'h1':
          case 'h6':
          case 'h24':
            return m.ch[sortKey];
          case 'progress':
            return L.graduated ? 2 : L.progress;
          default:
            return null;
        }
      };
      r = r.slice().sort((a, b) => {
        const x = getVal(a);
        const y = getVal(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
      });
    }

    return r;
  }, [tokens, q, pair, tab, sortKey, sortDir, dsMap]);

  const visible = useMemo(() => sortedRows.slice(0, shown), [sortedRows, shown]);

  useEffect(() => {
    const need = visible
      .filter((L) => L.graduated && isNum(L.priceUsd))
      .map((L) => L.address);
    if (!need.length) return;
    let alive = true;
    fetchDexPairs(need).then((m) => {
      if (!alive || !m.size) return;
      setDsMap((prev) => {
        const next = new Map(prev);
        for (const [a, p] of m) next.set(a, p);
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [visible]);

  const buildLink = (patch: { tab?: string; pair?: string; q?: string }) => {
    const p = new URLSearchParams({ tab, pair, q, ...patch });
    for (const [k, v] of [...p]) {
      if (!v || v === 'all' || (k === 'tab' && v === 'top')) p.delete(k);
    }
    const qs = p.toString();
    return '#/' + (qs ? '?' + qs : '');
  };

  const nowSec = Date.now() / 1000;
  const launched24h = tokens.filter((x) => (x.createdAt || 0) > nowSec - 86400).length;
  const graduatedCount = tokens.filter((x) => x.graduated).length;
  const newest = tokens.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

  const handleSort = (key: string) => {
    if (!key) return;
    if (sortKey === key) {
      if (sortDir === -1) setSortDir(1);
      else setSortKey(null);
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  };

  return (
    <>
      <a className="snip-cta" href="#/sniper">
        <span className="snip-cta-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </span>
        <div className="snip-cta-copy">
          <b>SNIPETECH Sniper</b>
          <span>Paste a CA, buy in one click, sell by percent.</span>
        </div>
        <span className="snip-cta-btn">Open Sniper</span>
      </a>

      <section className="hero">
        <div>
          <h1>
            <img src={SITE_CONFIG.LOGO_SRC} alt="" width={28} height={28} style={{ borderRadius: 7 }} />
            <span>{SITE_CONFIG.PROJECT_NAME}</span>
          </h1>
          <p>
            Tokens launched on{' '}
            <a href="https://ponsfamily.com/" target="_blank" rel="noopener noreferrer">
              Pons
            </a>{' '}
            on Robinhood Chain: live prices, market cap, volume, trades and charts.
          </p>
        </div>

        <div className="stats">
          <div className="stat">
            <span>Tokens tracked</span>
            <b>{formatNum(tokens.length)}</b>
          </div>
          <div className="stat">
            <span>Launched 24h</span>
            <b>{formatNum(launched24h)}</b>
          </div>
          <div className="stat">
            <span>Graduated</span>
            <b>{formatNum(graduatedCount)}</b>
          </div>
          <div className="stat">
            <span>Latest launch</span>
            <b>
              {newest ? (
                <>
                  <a href={`#/token/${newest.address}`}>{newest.symbol}</a> · {formatAge(newest.createdAt)} ago
                </>
              ) : (
                '—'
              )}
            </b>
          </div>
        </div>
      </section>

      <div className="toolbar">
        <nav className="tabs" aria-label="Token feeds">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={t.id === tab ? 'on' : ''}
              title={t.hint}
              onClick={() => onNavigate(buildLink({ tab: t.id }))}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="tools">
          <div className="seg" title="Quote asset of the token's pool">
            {PAIRS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={v === pair ? 'on' : ''}
                onClick={() => onNavigate(buildLink({ pair: v }))}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`live ${live ? 'on' : ''}`}
            title="Auto-refresh every 20s"
            onClick={() => setLive((v) => !v)}
          >
            <i />
            Live <span>{live ? `${countdown}s` : 'paused'}</span>
          </button>
        </div>
      </div>

      {q ? (
        <div className="qbar">
          <span>
            Results for “<b>{q}</b>”
          </span>
          <button type="button" onClick={() => onNavigate(buildLink({ q: '' }))}>
            clear ✕
          </button>
        </div>
      ) : null}

      <div className="tblwrap">
        <table className="tbl">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.k}
                  className={`${c.cls}${c.sort ? ' sortable' : ''}${sortKey === c.sort ? ' on' : ''}`}
                  title={c.title}
                  onClick={() => c.sort && handleSort(c.sort)}
                >
                  {c.t}
                  {sortKey === c.sort && c.sort ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((L, i) => {
                const m = metricsOf(L);
                const m5 = formatPct(m.ch.m5);
                const h1 = formatPct(m.ch.h1);
                const h6 = formatPct(m.ch.h6);
                const h24 = formatPct(m.ch.h24);
                return (
                  <tr
                    key={L.address}
                    tabIndex={0}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest('a')) return;
                      onNavigate(`#/token/${L.address}`);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onNavigate(`#/token/${L.address}`);
                    }}
                  >
                    <td className="c-rank">{i + 1}</td>
                    <td className="c-token">
                      <a href={`#/token/${L.address}`} className="tok">
                        <TokenLogo address={L.address} symbol={L.symbol} name={L.name} artwork={L.artwork} size={30} />
                        <span className="tn">
                          <span className="l1">
                            <b>{L.symbol}</b>
                            {L.quote ? (
                              <span className={`ver ${/^W?ETH$/.test(L.quote) ? 'v1' : 'v2'}`}>{L.quote}</span>
                            ) : null}
                            {L.official ? <span className="tag off">official</span> : null}
                          </span>
                          <span className="l2">{L.name}</span>
                        </span>
                      </a>
                    </td>
                    <td className="num mono">{formatPrice(L.priceUsd)}</td>
                    <td className="num hide-sm">{formatAge(L.createdAt)}</td>
                    <td className="num hide-md">{formatNum(m.tx)}</td>
                    <td className="num">{formatCompact(m.vol)}</td>
                    <td className={`num hide-md mono ${m5.cls}`}>{m5.text}</td>
                    <td className={`num mono ${h1.cls}`}>{h1.text}</td>
                    <td className={`num hide-md mono ${h6.cls}`}>{h6.text}</td>
                    <td className={`num mono ${h24.cls}`}>{h24.text}</td>
                    <td className="num">{formatCompact(m.liq)}</td>
                    <td className="num">{formatCompact(L.marketCapUsd)}</td>
                    <td className="c-status">
                      {L.graduated ? (
                        <span className="tag grad">Graduated</span>
                      ) : (
                        <span className="tag">
                          Curve{isNum(L.progress) ? ` ${Math.round(L.progress * 100)}%` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={COLS.length} className="empty">
                  {loading ? 'Loading Pons tokens…' : err || 'No tokens match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="below">
        <span className="muted">
          {sortedRows.length ? `Showing ${visible.length} of ${sortedRows.length} tokens` : ''}
        </span>
        {sortedRows.length > shown ? (
          <button type="button" className="btn" onClick={() => setShown((s) => s + PAGE_SIZE)}>
            Show more
          </button>
        ) : null}
      </div>
    </>
  );
}
