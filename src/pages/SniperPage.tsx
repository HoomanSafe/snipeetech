import { useEffect, useRef, useState } from 'react';
import { SITE_CONFIG } from '../config/siteConfig';
import { type TokenItem } from '../lib/api';
import { formatCompact, isNum, shortAddr } from '../lib/format';
import { applySlippage, type TokenRoute } from '../lib/sniperCore';
import {
  DEFAULT_SNIPER_CFG,
  type TradeQuote,
  executeBuy,
  executeSell,
  fetchOnChainBalances,
  fmtTokUnits,
  fmtUnits,
  loadOnChainToken,
  loadSniperCfg,
  quoteOnChain,
  refreshCurveRoute,
  saveSniperCfg,
  toUnits,
  tradeErrMsg,
} from '../lib/sniperTrade';
import { walletManager } from '../lib/walletManager';
import { TokenLogo } from '../components/TokenLogo';
import { WalletButton } from '../components/WalletButton';

const SLIPS = [1, 5, 10, 20];
const isAddr = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(String(a || '').trim());

interface TxLogEntry {
  side: 'buy' | 'sell';
  label: string;
  hash: string;
  t: number;
  sym: string;
}

export function SniperPage({
  initialCa,
  tokens,
  onOpenWallet,
}: {
  initialCa: string;
  tokens: TokenItem[];
  onOpenWallet: () => void;
}) {
  const [ca, setCa] = useState(initialCa);
  const [route, setRoute] = useState<TokenRoute | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [bal, setBal] = useState<{ eth: bigint; tok: bigint } | null>(null);
  const [cfg, setCfg] = useState(() => loadSniperCfg());
  const [editQuick, setEditQuick] = useState(false);
  const [customAmt, setCustomAmt] = useState('');
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [log, setLog] = useState<TxLogEntry[]>([]);
  const [, setWalletTick] = useState(0);
  const qSeq = useRef(0);

  useEffect(() => {
    document.title = `Sniper — ${SITE_CONFIG.PROJECT_NAME}`;
    return walletManager.subscribe(() => setWalletTick((t) => t + 1));
  }, []);

  const loadTokenAddr = async (rawAddr: string) => {
    const clean = String(rawAddr || '').trim();
    setCa(clean);
    if (!isAddr(clean)) {
      setErr('That is not a contract address.');
      return;
    }
    setCustomAmt('');
    setQuote(null);
    setErr('');
    setOk('');
    setLoadingToken(true);
    setRoute(null);
    window.history.replaceState(null, '', '#/sniper?ca=' + clean.toLowerCase());
    try {
      const r = await loadOnChainToken(clean);
      setRoute(r);
    } catch (e) {
      setErr('Could not read this token. ' + tradeErrMsg(e));
    } finally {
      setLoadingToken(false);
    }
  };

  useEffect(() => {
    if (initialCa && isAddr(initialCa)) {
      loadTokenAddr(initialCa);
    }
  }, [initialCa]);

  const acct = walletManager.activeAccount();

  const refreshBal = async () => {
    if (!route || !acct || route.stage === 'unsupported') {
      if (!acct) setBal(null);
      return;
    }
    try {
      const b = await fetchOnChainBalances(route.token, acct);
      setBal(b);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshBal();
    const id = setInterval(() => {
      if (!document.hidden && !busy) refreshBal();
    }, 12000);
    return () => clearInterval(id);
  }, [route?.token, route?.stage, acct, busy]);

  const previewQuote = async (side: 'buy' | 'sell', amount: bigint) => {
    const my = ++qSeq.current;
    if (!route || amount <= 0n || (route.stage !== 'curve' && route.stage !== 'pool')) {
      setQuote(null);
      return;
    }
    try {
      const q = await quoteOnChain(route, side, amount);
      if (my === qSeq.current) setQuote(q);
    } catch {
      if (my === qSeq.current) setQuote(null);
    }
  };

  const runTrade = async (side: 'buy' | 'sell', amount: bigint, label: string) => {
    if (busy || !route) return;
    if (!walletManager.isTradeReady()) {
      onOpenWallet();
      return;
    }
    setBusy(true);
    setErr('');
    setOk('');
    setTxHash(null);
    setStatus(label);
    try {
      const st = (s: string) => setStatus(`${label}: ${s.toLowerCase()}`);
      const hash =
        side === 'buy'
          ? await executeBuy(route, amount, cfg.slip * 100, st)
          : await executeSell(route, amount, cfg.slip * 100, st);
      setLog((prev) => [
        { side, label, hash, t: Date.now(), sym: route.symbol || 'TOKEN' },
        ...prev.slice(0, 15),
      ]);
      setOk(`${label} confirmed.`);
      setTxHash(hash);
      await refreshCurveRoute(route).catch(() => {});
      await refreshBal();
    } catch (e) {
      setErr(tradeErrMsg(e));
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const handleBuyEth = (ethStr: string) => {
    const v = toUnits(ethStr, 18);
    if (v <= 0n) {
      setErr('Enter an ETH amount.');
      return;
    }
    if (bal && v > bal.eth) {
      setErr('Not enough ETH.');
      return;
    }
    runTrade('buy', v, `Buy ${ethStr} ETH`);
  };

  const handleSellPct = (pct: number) => {
    if (!walletManager.isTradeReady()) {
      onOpenWallet();
      return;
    }
    const tokBal = bal ? bal.tok : 0n;
    if (tokBal <= 0n) {
      setErr(`No ${route?.symbol || 'tokens'} to sell.`);
      return;
    }
    const amt = pct >= 100 ? tokBal : (tokBal * BigInt(pct)) / 100n;
    runTrade('sell', amt, `Sell ${pct}%`);
  };

  const okToTrade = Boolean(route && (route.stage === 'curve' || route.stage === 'pool'));
  const d = route?.decimals ?? 18;
  const listToken = route
    ? tokens.find((x) => x.address.toLowerCase() === route.token.toLowerCase())
    : undefined;
  const minOut = quote ? applySlippage(quote.out, cfg.slip * 100) : null;

  return (
    <section className="staking sniper-pg">
      <div className="sk-head">
        <div>
          <span className="sk-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="7" />
              <circle cx="12" cy="12" r="2" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </span>
          <h1>Sniper</h1>
          <p className="muted">Paste a CA, buy in one click, sell by percent.</p>
        </div>
        <WalletButton onClick={onOpenWallet} />
      </div>

      <form
        className="sp-ca"
        onSubmit={(e) => {
          e.preventDefault();
          loadTokenAddr(ca);
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          value={ca}
          spellCheck={false}
          autoComplete="off"
          placeholder="Paste token contract address (0x…)"
          aria-label="Token contract address"
          onChange={(e) => {
            const val = e.target.value;
            setCa(val);
            if (isAddr(val) && (!route || route.token !== val.trim().toLowerCase())) {
              loadTokenAddr(val);
            }
          }}
        />
        <button
          type="button"
          className="sk-btn"
          onClick={() => {
            navigator.clipboard
              ?.readText()
              .then((t) => loadTokenAddr(t))
              .catch(() => {});
          }}
        >
          Paste
        </button>
        <button type="submit" className="sk-btn pri">
          Load
        </button>
      </form>

      <div className="sp-grid">
        <div>
          {loadingToken ? (
            <div className="card sp-tok">
              <div className="loading">Reading token…</div>
            </div>
          ) : !route ? (
            <div className="card sp-tok sp-empty">
              <span className="sk-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="7" />
                  <circle cx="12" cy="12" r="2" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
              </span>
              <b>Paste a Pons CA to start</b>
              <span className="muted">Curve and graduated tokens, quoted live from the chain.</span>
            </div>
          ) : (
            <div className="card sp-tok">
              <div className="sp-th">
                {listToken ? (
                  <TokenLogo
                    address={listToken.address}
                    symbol={listToken.symbol}
                    name={listToken.name}
                    artwork={listToken.artwork}
                    size={44}
                  />
                ) : (
                  <span className="sp-ph">{(route.symbol || '?').slice(0, 2)}</span>
                )}
                <div>
                  <h2>
                    {route.name || route.symbol}{' '}
                    {route.name && route.symbol && route.name !== route.symbol ? (
                      <span className="muted">{route.symbol}</span>
                    ) : null}
                  </h2>
                  <div className="sp-sub">
                    <span className="mono">{shortAddr(route.token)}</span>
                    {route.stage === 'curve' ? (
                      <span className="sp-tag cv">Bonding curve</span>
                    ) : route.stage === 'pool' ? (
                      <span className="sp-tag gd">Graduated</span>
                    ) : route.stage === 'graduating' ? (
                      <span className="sp-tag wt">Graduating</span>
                    ) : (
                      <span className="sp-tag no">Not tradable here</span>
                    )}
                    {listToken && isNum(listToken.marketCapUsd) ? (
                      <span className="muted">MC {formatCompact(listToken.marketCapUsd)}</span>
                    ) : null}
                  </div>
                </div>
                <a className="chip" href={`#/token/${route.token}`}>
                  Chart
                </a>
              </div>

              {route.stage === 'unsupported' ? (
                <div className="bwarn">{route.why || 'Not tradable here'}</div>
              ) : null}
              {route.stage === 'graduating' ? (
                <div className="bwarn">
                  This token filled its curve and is moving to its pool. Trading opens again in a moment.
                </div>
              ) : null}

              {route.stage === 'curve' && route.cs ? (
                <div className="sp-prog">
                  <div>
                    <span>Curve</span>
                    <b>
                      {listToken && isNum(listToken.progress)
                        ? `${(listToken.progress * 100).toFixed(1)}%`
                        : 'Live'}
                    </b>
                  </div>
                  <div className="pbar">
                    <i
                      style={{
                        width: `${
                          listToken && isNum(listToken.progress)
                            ? Math.min(100, listToken.progress * 100).toFixed(1)
                            : 100
                        }%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="sp-bals">
                <div>
                  <span>You hold</span>
                  <b className="mono">{acct ? (bal ? fmtTokUnits(bal.tok, d) : '…') : '—'}</b>
                  <em>{route.symbol}</em>
                </div>
                <div>
                  <span>ETH balance</span>
                  <b className="mono">{acct ? (bal ? fmtUnits(bal.eth, 18, 4) : '…') : '—'}</b>
                  <em>
                    {acct
                      ? walletManager.mode === 'tw'
                        ? 'Trading wallet'
                        : 'Browser wallet'
                      : 'Set up a wallet'}
                  </em>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bcard sp-trade">
          <div className="brow">
            <span className="blab">Quick buy</span>
            <button
              type="button"
              className="sp-edit"
              onClick={() => {
                if (editQuick) {
                  const cleaned = cfg.quick.map((q, i) =>
                    toUnits(q) > 0n ? q : DEFAULT_SNIPER_CFG.quick[i]
                  );
                  const next = { ...cfg, quick: cleaned };
                  setCfg(next);
                  saveSniperCfg(next);
                }
                setEditQuick((v) => !v);
              }}
            >
              {editQuick ? 'Done' : 'Edit'}
            </button>
          </div>

          <div className="sp-quick">
            {cfg.quick.map((q, i) =>
              editQuick ? (
                <label key={i} className="sp-qe">
                  <input
                    inputMode="decimal"
                    value={q}
                    aria-label={`Quick buy ${i + 1} ETH`}
                    onChange={(e) => {
                      const nextQ = cfg.quick.slice();
                      nextQ[i] = e.target.value.replace(/[^\d.]/g, '');
                      setCfg({ ...cfg, quick: nextQ });
                    }}
                  />
                  <span>ETH</span>
                </label>
              ) : (
                <button
                  key={i}
                  type="button"
                  className="sp-qb"
                  disabled={!okToTrade || busy}
                  onClick={() => handleBuyEth(q)}
                >
                  <b>{q}</b>
                  <span>ETH</span>
                </button>
              )
            )}
          </div>

          <div className="bbox sp-custom">
            <div className="brow">
              <span className="blab">Custom</span>
              <span className="sm muted">
                {bal ? `Balance ${fmtUnits(bal.eth, 18, 4)} ETH` : ''}
              </span>
            </div>
            <div className="bamt">
              <input
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.0"
                value={customAmt}
                disabled={busy}
                aria-label="Custom ETH amount"
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.]/g, '');
                  setCustomAmt(v);
                  previewQuote('buy', toUnits(v));
                }}
              />
              <span className="bsym">ETH</span>
              <button
                type="button"
                className="sk-btn pri sp-cb"
                disabled={!okToTrade || busy}
                onClick={() => handleBuyEth(customAmt)}
              >
                Buy
              </button>
            </div>
          </div>

          {quote && quote.side === 'buy' && minOut != null ? (
            <div className="bq sp-q">
              <div>
                <span>You get</span>
                <b className="mono">
                  ≈ {fmtTokUnits(quote.out, d)} {route?.symbol}
                </b>
              </div>
              <div>
                <span>Minimum</span>
                <span className="mono">
                  {fmtTokUnits(minOut, d)} {route?.symbol}
                </span>
              </div>
              {quote.impact != null ? (
                <div>
                  <span>Price impact</span>
                  <span className={quote.impact > 0.15 ? 'high' : quote.impact > 0.05 ? 'warn' : ''}>
                    {(quote.impact * 100).toFixed(2)}%
                  </span>
                </div>
              ) : null}
              {quote.refund && quote.refund > 0n ? (
                <div>
                  <span>Refunded</span>
                  <span className="mono">{fmtUnits(quote.refund, 18, 6)} ETH</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="brow sp-sh">
            <span className="blab">Sell</span>
            <span className="sm muted">
              {bal && route ? `${fmtTokUnits(bal.tok, d)} ${route.symbol}` : ''}
            </span>
          </div>

          <div className="sp-sells">
            {cfg.sells.map((p) => (
              <button
                key={p}
                type="button"
                className="sp-sb"
                disabled={!okToTrade || busy || (bal ? bal.tok === 0n : false)}
                onMouseEnter={() => {
                  if (bal && bal.tok > 0n && !busy) {
                    const amt = p >= 100 ? bal.tok : (bal.tok * BigInt(p)) / 100n;
                    previewQuote('sell', amt);
                  }
                }}
                onClick={() => handleSellPct(p)}
              >
                {p === 100 ? 'Sell all' : `${p}%`}
              </button>
            ))}
          </div>

          {quote && quote.side === 'sell' && minOut != null ? (
            <div className="bq sp-q">
              <div>
                <span>You get</span>
                <b className="mono">≈ {fmtUnits(quote.out, 18, 6)} ETH</b>
              </div>
              <div>
                <span>Minimum</span>
                <span className="mono">{fmtUnits(minOut, 18, 6)} ETH</span>
              </div>
              {quote.impact != null ? (
                <div>
                  <span>Price impact</span>
                  <span className={quote.impact > 0.15 ? 'high' : quote.impact > 0.05 ? 'warn' : ''}>
                    {(quote.impact * 100).toFixed(2)}%
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="sp-f">
            <span className="blab">Slippage</span>
            <div className="bseg sm sp-slip">
              {SLIPS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cfg.slip === s ? 'on' : ''}
                  onClick={() => {
                    const next = { ...cfg, slip: s };
                    setCfg(next);
                    saveSniperCfg(next);
                  }}
                >
                  {s}%
                </button>
              ))}
              <input
                className="sp-in sm"
                inputMode="decimal"
                value={SLIPS.includes(cfg.slip) ? '' : String(cfg.slip)}
                placeholder="Custom"
                aria-label="Custom slippage %"
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (v > 0 && v <= 50) {
                    const next = { ...cfg, slip: v };
                    setCfg(next);
                    saveSniperCfg(next);
                  }
                }}
              />
            </div>
          </div>

          {err ? (
            <div className="berr">{err}</div>
          ) : status ? (
            <div className="sp-status">
              <span className="sp-spin" />
              {status}
            </div>
          ) : ok ? (
            <div className="bdone">
              <span>
                {ok}{' '}
                {txHash ? (
                  <a href={`${SITE_CONFIG.EXPLORER}/tx/${txHash}`} target="_blank" rel="noopener noreferrer">
                    View transaction
                  </a>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      {log.length ? (
        <div className="card sk-card sp-log">
          <div className="sk-ct">
            <h2>This session</h2>
          </div>
          {log.slice(0, 8).map((x, idx) => (
            <div key={`${x.hash}-${idx}`} className="sp-lr">
              <span className={x.side === 'buy' ? 'up' : 'down'}>
                {x.side === 'buy' ? 'Buy' : 'Sell'}
              </span>
              <span>{x.sym}</span>
              <span className="muted">{x.label}</span>
              <a
                className="mono"
                href={`${SITE_CONFIG.EXPLORER}/tx/${x.hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {x.hash.slice(0, 10)}…
              </a>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
