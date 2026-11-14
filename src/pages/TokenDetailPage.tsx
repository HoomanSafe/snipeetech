import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { SITE_CONFIG } from '../config/siteConfig';
import {
  type Candle,
  type DexPair,
  type TokenItem,
  type TradeRow,
  fetchChart,
  fetchDexPairs,
  fetchLaunchInfo,
  fetchSnapshot,
  fetchTrades,
} from '../lib/api';
import {
  EXPLORER,
  formatAge,
  formatCompact,
  formatDateTime,
  formatNum,
  formatPct,
  formatPrice,
  isNum,
  safeHref,
  shortAddr,
  tradeUrl,
} from '../lib/format';
import { TokenLogo } from '../components/TokenLogo';
import { TradePanel } from '../components/TradePanel';

const INTERVALS = ['1h', '6h', '1d', '1w', 'all'] as const;

function defaultInterval(L: TokenItem): string {
  const a = isNum(L.createdAt) ? Date.now() / 1000 - L.createdAt : 1e9;
  if (a < 3600) return '1h';
  if (a < 6 * 3600) return '6h';
  if (a < 86400) return '1d';
  if (a < 7 * 86400) return '1w';
  return 'all';
}

const fmtAxis = (v: number) => (!Number.isFinite(v) ? '' : Math.abs(v) < 1e-14 ? '0' : formatPrice(v, ''));

export function TokenDetailPage({
  address,
  tokens,
  onCopy,
  onOpenWallet,
}: {
  address: string;
  tokens: TokenItem[];
  onCopy: (text: string) => void;
  onOpenWallet: () => void;
}) {
  const addr = address.toLowerCase();
  const [token, setToken] = useState<TokenItem | null>(
    () => tokens.find((x) => x.address.toLowerCase() === addr) || null
  );
  const [loading, setLoading] = useState(!token);
  const [ds, setDs] = useState<DexPair | null>(null);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof fetchLaunchInfo>>>(null);
  const [trades, setTrades] = useState<TradeRow[] | null>(null);
  const [tradesErr, setTradesErr] = useState(false);

  const [intervalVal, setIntervalVal] = useState<string>(() =>
    token ? defaultInterval(token) : '1d'
  );
  const [mode, setMode] = useState<'price' | 'mcap'>('price');
  const [chartNote, setChartNote] = useState('');

  const chartBoxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const barsRef = useRef<Array<{ time: UTCTimestamp; open: number; high: number; low: number; close: number }>>([]);

  useEffect(() => {
    let alive = true;
    const cached = tokens.find((x) => x.address.toLowerCase() === addr) || null;
    if (cached) {
      setToken(cached);
      setIntervalVal(defaultInterval(cached));
      setLoading(false);
    } else {
      setLoading(true);
    }

    fetchSnapshot(addr)
      .then((snap) => {
        if (!alive) return;
        if (snap) {
          setToken((prev) => {
            const merged = prev ? { ...prev, ...snap, ch24: prev.ch24 ?? snap.ch24 } : snap;
            if (!prev) setIntervalVal(defaultInterval(merged));
            return merged;
          });
        }
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [addr]);

  useEffect(() => {
    if (!token) return;
    document.title = `${token.symbol} ${formatPrice(token.priceUsd)} — ${SITE_CONFIG.PROJECT_NAME}`;
  }, [token]);

  // Build chart instance
  useEffect(() => {
    if (!token || !chartBoxRef.current) return;
    const box = chartBoxRef.current;

    const autoscale = () => {
      const bars = barsRef.current;
      if (!bars.length) return null;
      let from = -Infinity;
      let to = Infinity;
      const vr = chartRef.current?.timeScale().getVisibleRange();
      if (vr) {
        from = Number(vr.from);
        to = Number(vr.to);
      }
      let inView = bars.filter((b) => Number(b.time) >= from && Number(b.time) <= to);
      if (!inView.length) inView = bars;
      const lows = inView.map((b) => Math.min(b.open, b.close)).sort((a, b) => a - b);
      const highs = inView.map((b) => Math.max(b.open, b.close)).sort((a, b) => a - b);
      const cut = inView.length >= 30 ? Math.floor(inView.length * 0.02) : 0;
      let lo = lows[cut];
      let hi = highs[highs.length - 1 - cut];
      const last = bars[bars.length - 1];
      if (last && Number(last.time) >= from && Number(last.time) <= to) {
        lo = Math.min(lo, last.close);
        hi = Math.max(hi, last.close);
      }
      const span = hi - lo > hi * 1e-6 ? hi - lo : Math.abs(hi) * 0.1 || 1e-12;
      return {
        priceRange: {
          minValue: Math.max(0, lo - span * 0.3),
          maxValue: hi + span * 0.08,
        },
      };
    };

    const chart = createChart(box, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(226, 234, 224, 0.7)',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(200, 255, 0, 0.06)' },
        horzLines: { color: 'rgba(200, 255, 0, 0.07)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(200, 255, 0, 0.16)',
        scaleMargins: { top: 0.08, bottom: 0 },
      },
      timeScale: {
        borderColor: 'rgba(200, 255, 0, 0.16)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 0 },
      localization: { priceFormatter: fmtAxis },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#c8ff00',
      downColor: '#ff5c39',
      borderVisible: false,
      wickUpColor: '#c8ff00',
      wickDownColor: '#ff5c39',
      priceFormat: { type: 'custom', formatter: fmtAxis, minMove: 1e-12 },
      autoscaleInfoProvider: autoscale as any,
      priceLineColor: '#c8ff00',
      priceLineWidth: 1,
    });

    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      color: 'rgba(200, 255, 0, 0.18)',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chartRef.current = chart;
    seriesRef.current = series;
    volRef.current = vol;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
    };
  }, [token?.address]);

  const loadChartData = async (fit: boolean) => {
    if (!token || !seriesRef.current || !volRef.current) return;
    try {
      const d = await fetchChart(token.address, intervalVal);
      const candles = (d.candles || []).filter((k: Candle) =>
        [k.open, k.high, k.low, k.close].every(isNum)
      );
      if (!candles.length) {
        setChartNote(
          d.unavailableReason ? `No chart: ${d.unavailableReason}` : 'No trades yet — nothing to chart.'
        );
        barsRef.current = [];
        seriesRef.current.setData([]);
        volRef.current.setData([]);
        return;
      }
      const mult = mode === 'mcap' ? token.supply || 1e9 : 1;
      const mapped = candles.map((k) => ({
        time: k.time as UTCTimestamp,
        open: k.open * mult,
        high: k.high * mult,
        low: k.low * mult,
        close: k.close * mult,
      }));
      barsRef.current = mapped;
      seriesRef.current.setData(mapped);
      volRef.current.setData(
        candles.map((k) => ({
          time: k.time as UTCTimestamp,
          value: isNum(k.volume) ? k.volume : 0,
          color: k.close >= k.open ? 'rgba(200, 255, 0, 0.28)' : 'rgba(255, 92, 57, 0.28)',
        }))
      );
      if (fit) chartRef.current?.timeScale().fitContent();
      setChartNote(
        `${mode === 'mcap' ? 'Market cap (price × supply)' : 'Price'} in USD · ${candles.length} ${d.effectiveRange || intervalVal} candles · window ${intervalVal}`
      );
    } catch {
      setChartNote('Chart data briefly unavailable.');
    }
  };

  useEffect(() => {
    if (!token) return;
    loadChartData(true);
  }, [token?.address, intervalVal]);

  useEffect(() => {
    if (!token) return;
    loadChartData(false);
  }, [mode]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const loadEnrich = async () => {
      const [m, inf] = await Promise.all([
        token.graduated ? fetchDexPairs([addr]) : Promise.resolve(new Map<string, DexPair>()),
        fetchLaunchInfo(addr).catch(() => null),
      ]);
      if (!alive) return;
      setDs(m.get(addr) || null);
      if (inf) setInfo(inf);
    };

    const loadTrades = async () => {
      try {
        const t = await fetchTrades(addr);
        if (alive) {
          setTrades(t);
          setTradesErr(false);
        }
      } catch {
        if (alive) setTradesErr(true);
      }
    };

    loadEnrich().then(loadTrades);

    const t1 = setInterval(() => {
      if (!document.hidden) loadTrades();
    }, 15000);
    const t2 = setInterval(async () => {
      if (document.hidden) return;
      try {
        const snap = await fetchSnapshot(addr);
        if (alive && snap) {
          setToken((prev) => (prev ? { ...prev, ...snap, ch24: prev.ch24 ?? snap.ch24 } : snap));
        }
        loadChartData(false);
      } catch {
        // ignore
      }
    }, 20000);

    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
    };
  }, [addr, token?.address]);

  if (loading) {
    return <div className="loading">Loading token…</div>;
  }

  if (!token) {
    return (
      <div className="notfound">
        <h2>Not a Pons token</h2>
        <p className="muted mono">{addr} is not a Pons launch.</p>
        <a className="btn pri" href="#/">
          Back to screener
        </a>
      </div>
    );
  }

  const L = token;
  const qs = info?.quoteSymbol || L.quote;
  const pc = ds?.priceChange || {};
  const ch = (k: 'm5' | 'h1' | 'h6' | 'h24') =>
    isNum(pc[k]) ? pc[k] / 100 : k === 'h24' ? L.ch24 : null;

  const buys = ds?.txns?.h24?.buys ?? null;
  const sells = ds?.txns?.h24?.sells ?? null;
  const bPct = buys != null && sells != null && buys + sells > 0 ? (buys / (buys + sells)) * 100 : null;
  const liq = L.liquidityUsd ?? ds?.liquidity?.usd ?? null;
  const vol = L.volumeUsd ?? ds?.volume?.h24 ?? null;

  const soc = L.socials || { website: L.website, x: L.twitter, telegram: L.telegram };
  const extLinks: Array<[string | null | undefined, string]> = [
    [ds?.url, 'DexScreener'],
    [ds?.pairAddress ? `https://www.geckoterminal.com/robinhood/pools/${ds.pairAddress}` : null, 'GeckoTerminal'],
    [soc.website, 'Website'],
    [soc.x, 'X'],
    [soc.telegram, 'Telegram'],
  ];
  const seenUrls = new Set<string>();

  return (
    <>
      <a className="back" href="#/">
        ← Screener
      </a>

      <section className="dhead">
        <div className="dt">
          <TokenLogo address={L.address} symbol={L.symbol} name={L.name} artwork={L.artwork} size={52} />
          <div>
            <h1>
              {L.name} <span className="muted">{L.symbol}</span>
              {L.quote ? (
                <span className={`ver ${/^W?ETH$/.test(L.quote) ? 'v1' : 'v2'}`}>{L.quote}</span>
              ) : null}
              {L.official ? <span className="tag off">official</span> : null}
            </h1>
            <div className="sub">
              <span className="mono">{shortAddr(L.address)}</span>
              <button
                type="button"
                className="cp big"
                onClick={() => onCopy(L.address)}
                title="Copy contract address"
              >
                ⧉ Copy CA
              </button>
              {L.graduated ? (
                <span className="tag grad">Graduated</span>
              ) : (
                <span className="tag">
                  Curve{isNum(L.progress) ? ` ${Math.round(L.progress * 100)}%` : ''}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="links">
          <a className="chip pri" href={tradeUrl(L.address)} target="_blank" rel="noopener noreferrer">
            Buy on Pons ↗
          </a>
          <a
            className="chip"
            href={`${EXPLORER}/token/${L.address}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Blockscout ↗
          </a>
          {extLinks.map(([u, label]) => {
            const href = safeHref(u);
            if (!href || seenUrls.has(href)) return null;
            seenUrls.add(href);
            return (
              <a
                key={label}
                className="chip"
                href={href}
                target="_blank"
                rel={label === 'DexScreener' || label === 'GeckoTerminal' ? 'noopener noreferrer' : 'noopener noreferrer nofollow'}
              >
                {label}
                {label === 'DexScreener' || label === 'GeckoTerminal' ? ' ↗' : ''}
              </a>
            );
          })}
        </div>
      </section>

      <div className="dgrid">
        <div className="dmain">
          <div className="card chartcard">
            <div className="ctool">
              <div className="seg">
                {INTERVALS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={v === intervalVal ? 'on' : ''}
                    onClick={() => setIntervalVal(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
              <div className="seg">
                <button
                  type="button"
                  className={mode === 'price' ? 'on' : ''}
                  onClick={() => setMode('price')}
                >
                  Price
                </button>
                <button
                  type="button"
                  className={mode === 'mcap' ? 'on' : ''}
                  onClick={() => setMode('mcap')}
                >
                  MCap
                </button>
              </div>
            </div>
            <div ref={chartBoxRef} className="chart" />
            <div className="muted sm note">{chartNote}</div>
          </div>

          <div className="card">
            <div className="ch">
              <h3>Recent trades</h3>
              <span className="muted sm">auto-refresh 15s</span>
            </div>
            <div className="tblwrap">
              {trades === null ? (
                <div className="empty">
                  {tradesErr ? 'Trades briefly unavailable.' : 'Loading trades…'}
                </div>
              ) : !trades.length ? (
                <div className="empty">No trades yet.</div>
              ) : (
                <table className="tbl trades">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Type</th>
                      <th className="num">USD</th>
                      <th className="num">{qs || 'Quote'}</th>
                      <th className="num hide-sm">{L.symbol}</th>
                      <th className="num">Price</th>
                      <th className="hide-sm">Maker</th>
                      <th>Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.slice(0, 50).map((t, idx) => {
                      const buy = t.kind === 'buy';
                      const tokIsTo = (t.to_token_address || '').toLowerCase() === addr;
                      const tokAmt = +(tokIsTo ? t.to_token_amount : t.from_token_amount);
                      const qAmt = +(tokIsTo ? t.from_token_amount : t.to_token_amount);
                      const px = +(tokIsTo ? t.price_to_in_usd : t.price_from_in_usd);
                      const ts = Date.parse(t.block_timestamp) / 1000;
                      return (
                        <tr key={`${t.tx_hash}-${idx}`} className={buy ? 'buy' : 'sell'}>
                          <td className="muted">{formatAge(ts)} ago</td>
                          <td>
                            <span className="side">{buy ? 'Buy' : 'Sell'}</span>{' '}
                            <span className="muted sm">{t.venue}</span>
                          </td>
                          <td className="num">{formatCompact(+t.volume_in_usd)}</td>
                          <td className="num mono">{formatNum(qAmt, qAmt >= 1000 ? 0 : 4)}</td>
                          <td className="num mono hide-sm">{formatCompact(tokAmt, '')}</td>
                          <td className="num mono">{formatPrice(px)}</td>
                          <td className="hide-sm mono">
                            <a
                              className="addr"
                              href={`${EXPLORER}/address/${t.tx_from_address}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {shortAddr(t.tx_from_address)}
                            </a>
                          </td>
                          <td>
                            <a
                              className="ext"
                              href={`${EXPLORER}/tx/${t.tx_hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              ↗
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="dside">
          <TradePanel token={L} onOpenWallet={onOpenWallet} />

          <aside className="card side">
            <div className="pxrow">
              <div>
                <div className="muted sm">Price USD</div>
                <div className="big mono">{formatPrice(L.priceUsd)}</div>
              </div>
              {isNum(L.priceQuote) && qs ? (
                <div style={{ textAlign: 'right' }}>
                  <div className="muted sm">Price {qs}</div>
                  <div className="mid mono">{formatPrice(L.priceQuote, '')}</div>
                </div>
              ) : null}
            </div>

            <div className="kvgrid">
              <div className="kv">
                <span>Market Cap</span>
                <b>{formatCompact(L.marketCapUsd)}</b>
              </div>
              <div className="kv">
                <span>Liquidity</span>
                <b>{formatCompact(liq)}</b>
              </div>
              <div className="kv">
                <span>24h Volume</span>
                <b>{formatCompact(vol)}</b>
              </div>
              <div className="kv">
                <span>{ds?.fdv ? 'FDV' : 'Trades'}</span>
                <b>{ds?.fdv ? formatCompact(ds.fdv) : formatNum(L.tradeCount)}</b>
              </div>
            </div>

            <div className="chg">
              {(['m5', 'h1', 'h6', 'h24'] as const).map((k) => {
                const p = formatPct(ch(k));
                return (
                  <div key={k}>
                    <span>{k.toUpperCase()}</span>
                    <b className={p.cls}>{p.text}</b>
                  </div>
                );
              })}
            </div>

            {bPct != null ? (
              <div className="bs">
                <span className="up">{formatNum(buys)} buys</span>
                <div className="bsbar">
                  <i style={{ width: `${bPct.toFixed(1)}%` }} />
                </div>
                <span className="down">{formatNum(sells)} sells</span>
              </div>
            ) : null}

            {L.graduated ? (
              <div className="gradbox done">
                <div className="gh">
                  <span>Stage</span>
                  <b>Graduated</b>
                </div>
                <div className="muted sm">Left the bonding curve; trades in its pool.</div>
              </div>
            ) : (
              <div className="gradbox">
                <div className="gh">
                  <span>Bonding curve</span>
                  <b>{isNum(L.progress) ? `${(L.progress * 100).toFixed(1)}%` : '—'}</b>
                </div>
                <div className="pbar">
                  <i
                    style={{
                      width: `${isNum(L.progress) ? Math.min(100, L.progress * 100).toFixed(1) : 0}%`,
                    }}
                  />
                </div>
                <div className="muted sm">
                  {isNum(L.raisedQuote) && isNum(L.thresholdQuote)
                    ? `${formatNum(L.raisedQuote, 4)} / ${formatNum(L.thresholdQuote, 2)} ${qs || ''} raised toward graduation`
                    : 'Trades on the Pons bonding curve until graduation.'}
                </div>
              </div>
            )}

            <div className="info">
              <div className="ir">
                <span>Contract</span>
                <span>
                  <a
                    className="addr mono"
                    href={`${EXPLORER}/token/${L.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {shortAddr(L.address)}
                  </a>{' '}
                  <button type="button" className="cp" onClick={() => onCopy(L.address)}>
                    ⧉
                  </button>
                </span>
              </div>

              {(L.poolId || ds?.pairAddress) ? (
                <div className="ir">
                  <span>V4 pool ID</span>
                  <span>
                    <span className="mono">{shortAddr(L.poolId || ds?.pairAddress)}</span>{' '}
                    <button
                      type="button"
                      className="cp"
                      onClick={() => onCopy(L.poolId || ds?.pairAddress || '')}
                    >
                      ⧉
                    </button>
                  </span>
                </div>
              ) : null}

              {(info?.creator || L.deployer) ? (
                <div className="ir">
                  <span>Creator</span>
                  <span>
                    <a
                      className="addr mono"
                      href={`${EXPLORER}/address/${info?.creator || L.deployer}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {shortAddr(info?.creator || L.deployer)}
                    </a>{' '}
                    <button
                      type="button"
                      className="cp"
                      onClick={() => onCopy(info?.creator || L.deployer || '')}
                    >
                      ⧉
                    </button>
                  </span>
                </div>
              ) : null}

              {L.curve ? (
                <div className="ir">
                  <span>Curve</span>
                  <span>
                    <a
                      className="addr mono"
                      href={`${EXPLORER}/address/${L.curve}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {shortAddr(L.curve)}
                    </a>{' '}
                    <button type="button" className="cp" onClick={() => onCopy(L.curve || '')}>
                      ⧉
                    </button>
                  </span>
                </div>
              ) : null}

              {isNum(L.createdAt) ? (
                <div className="ir">
                  <span>Created</span>
                  <span>
                    {formatDateTime(L.createdAt)} <span className="muted">({formatAge(L.createdAt)} ago)</span>
                  </span>
                </div>
              ) : null}

              <div className="ir">
                <span>Supply</span>
                <span className="mono">{formatNum(L.supply)}</span>
              </div>

              {isNum(L.creatorTaxBps) && L.creatorTaxBps > 0 ? (
                <div className="ir">
                  <span>Creator tax</span>
                  <span className="mono">{L.creatorTaxBps / 100}%</span>
                </div>
              ) : null}

              {qs ? (
                <div className="ir">
                  <span>Pair</span>
                  <span>
                    {L.symbol} / {qs}
                  </span>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
