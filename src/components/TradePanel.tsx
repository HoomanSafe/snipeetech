import { useEffect, useRef, useState } from 'react';
import { SITE_CONFIG } from '../config/siteConfig';
import { type TokenItem } from '../lib/api';
import { applySlippage, type TokenRoute } from '../lib/sniperCore';
import {
  type TradeQuote,
  executeBuy,
  executeSell,
  fetchOnChainBalances,
  fmtTokUnits,
  fmtUnits,
  loadSniperCfg,
  quoteOnChain,
  refreshCurveRoute,
  saveSniperCfg,
  toUnits,
  tradeErrMsg,
  loadOnChainToken,
} from '../lib/sniperTrade';
import { walletManager } from '../lib/walletManager';
import { WalletButton } from './WalletButton';

const SLIPS = [1, 5, 10, 20];

export function TradePanel({
  token,
  onOpenWallet,
}: {
  token: TokenItem;
  onOpenWallet: () => void;
}) {
  const [route, setRoute] = useState<TokenRoute | null>(null);
  const [bal, setBal] = useState<{ eth: bigint; tok: bigint } | null>(null);
  const [cfg, setCfg] = useState(() => loadSniperCfg());
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amt, setAmt] = useState('');
  const [sellPct, setSellPct] = useState<number | null>(null);
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [, setWalletTick] = useState(0);
  const qSeq = useRef(0);

  useEffect(() => {
    return walletManager.subscribe(() => setWalletTick((t) => t + 1));
  }, []);

  useEffect(() => {
    let alive = true;
    setRoute(null);
    setQuote(null);
    setErr('');
    setOk('');
    loadOnChainToken(token.address)
      .then((r) => {
        if (alive) setRoute(r);
      })
      .catch((e) => {
        if (alive) setErr('Could not read this token. ' + tradeErrMsg(e));
      });
    return () => {
      alive = false;
    };
  }, [token.address]);

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
      // ignore RPC hiccup
    }
  };

  useEffect(() => {
    refreshBal();
    const id = setInterval(() => {
      if (!document.hidden && !busy) refreshBal();
    }, 15000);
    return () => clearInterval(id);
  }, [route?.token, route?.stage, acct, busy]);

  useEffect(() => {
    const my = ++qSeq.current;
    if (!route || (route.stage !== 'curve' && route.stage !== 'pool')) {
      setQuote(null);
      return;
    }
    const timer = setTimeout(async () => {
      const targetAmt =
        side === 'buy'
          ? toUnits(amt, 18)
          : sellPct && bal
            ? sellPct >= 100
              ? bal.tok
              : (bal.tok * BigInt(sellPct)) / 100n
            : 0n;
      if (targetAmt <= 0n) {
        if (my === qSeq.current) setQuote(null);
        return;
      }
      try {
        const q = await quoteOnChain(route, side, targetAmt);
        if (my === qSeq.current) setQuote(q);
      } catch {
        if (my === qSeq.current) setQuote(null);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [route, side, amt, sellPct, bal?.tok]);

  const ready = walletManager.isTradeReady();
  const needLabel =
    walletManager.mode === 'tw'
      ? walletManager.twExists()
        ? 'Unlock wallet'
        : 'Set up trading wallet'
      : 'Connect wallet';

  const okToTrade = route && (route.stage === 'curve' || route.stage === 'pool');
  const d = route?.decimals ?? 18;

  const handleTrade = async () => {
    if (!ready) {
      onOpenWallet();
      return;
    }
    if (!route || !okToTrade || busy) return;

    if (side === 'buy') {
      const v = toUnits(amt, 18);
      if (v <= 0n) {
        setErr('Enter an ETH amount.');
        return;
      }
      if (bal && v > bal.eth) {
        setErr('Not enough ETH.');
        return;
      }
      setBusy(true);
      setErr('');
      setOk('');
      setTxHash(null);
      setStatus(`Buy ${amt} ETH`);
      try {
        const hash = await executeBuy(route, v, cfg.slip * 100, (s) =>
          setStatus(`Buy ${amt} ETH: ${s.toLowerCase()}`)
        );
        setOk(`Buy ${amt} ETH confirmed.`);
        setTxHash(hash);
        await refreshCurveRoute(route).catch(() => {});
        await refreshBal();
      } catch (e) {
        setErr(tradeErrMsg(e));
      } finally {
        setBusy(false);
        setStatus('');
      }
      return;
    }

    if (!sellPct) {
      setErr('Pick how much to sell.');
      return;
    }
    const tokBal = bal ? bal.tok : 0n;
    if (tokBal <= 0n) {
      setErr(`No ${route.symbol || token.symbol} to sell.`);
      return;
    }
    const sellAmt = sellPct >= 100 ? tokBal : (tokBal * BigInt(sellPct)) / 100n;
    setBusy(true);
    setErr('');
    setOk('');
    setTxHash(null);
    setStatus(`Sell ${sellPct}%`);
    try {
      const hash = await executeSell(route, sellAmt, cfg.slip * 100, (s) =>
        setStatus(`Sell ${sellPct}%: ${s.toLowerCase()}`)
      );
      setOk(`Sell ${sellPct}% confirmed.`);
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

  const minOut = quote ? applySlippage(quote.out, cfg.slip * 100) : null;

  return (
    <section className="card tpcard" aria-label={`Buy or sell ${token.symbol}`}>
      <div className="tp-h">
        <b>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          Trade {token.symbol}
        </b>
        <WalletButton small onClick={onOpenWallet} />
      </div>

      <div className="seg tp-tabs">
        <button
          type="button"
          className={side === 'buy' ? 'on' : ''}
          onClick={() => {
            setSide('buy');
            setQuote(null);
            setErr('');
            setOk('');
          }}
        >
          Buy
        </button>
        <button
          type="button"
          className={side === 'sell' ? 'on' : ''}
          onClick={() => {
            setSide('sell');
            setQuote(null);
            setErr('');
            setOk('');
          }}
        >
          Sell
        </button>
      </div>

      {!route ? (
        <div className="loading sm" style={{ padding: '12px 0' }}>
          Loading on-chain route…
        </div>
      ) : route.stage === 'unsupported' ? (
        <div className="bwarn">{route.why || 'Not tradable here'}</div>
      ) : route.stage === 'graduating' ? (
        <div className="bwarn">Moving to its pool. Trading opens again in a moment.</div>
      ) : null}

      {side === 'buy' ? (
        <>
          <div className="bbox">
            <div className="brow">
              <span className="blab">Amount</span>
              <span className="sm muted">{bal ? `${fmtUnits(bal.eth, 18, 4)} ETH` : ''}</span>
            </div>
            <div className="bamt">
              <input
                inputMode="decimal"
                placeholder="0.0"
                value={amt}
                disabled={busy}
                aria-label="ETH amount"
                onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))}
              />
              <span className="bsym">ETH</span>
            </div>
          </div>
          <div className="bseg sm sp-pre">
            {cfg.quick.map((q) => (
              <button
                key={q}
                type="button"
                className={amt === q ? 'on' : ''}
                onClick={() => setAmt(q)}
              >
                {q}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="bbox">
            <div className="brow">
              <span className="blab">Sell</span>
              <span className="sm muted">
                {bal && route ? `${fmtTokUnits(bal.tok, d)} ${route.symbol}` : ''}
              </span>
            </div>
            <div className="bamt out">
              <span className="mono">
                {sellPct ? (sellPct === 100 ? 'All' : `${sellPct}%`) : 'Pick %'}
              </span>
              <span className="bsym">{token.symbol}</span>
            </div>
          </div>
          <div className="bseg sm sp-pre">
            {cfg.sells.map((p) => (
              <button
                key={p}
                type="button"
                className={sellPct === p ? 'on' : ''}
                onClick={() => setSellPct(p)}
              >
                {p === 100 ? 'Max' : `${p}%`}
              </button>
            ))}
          </div>
        </>
      )}

      {quote && quote.side === side && minOut != null ? (
        <div className="bq sp-q">
          <div>
            <span>You get</span>
            <b className="mono">
              ≈{' '}
              {quote.side === 'buy'
                ? `${fmtTokUnits(quote.out, d)} ${route?.symbol || token.symbol}`
                : `${fmtUnits(quote.out, 18, 6)} ETH`}
            </b>
          </div>
          <div>
            <span>Minimum</span>
            <span className="mono">
              {quote.side === 'buy'
                ? `${fmtTokUnits(minOut, d)} ${route?.symbol || token.symbol}`
                : `${fmtUnits(minOut, 18, 6)} ETH`}
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

      <button
        type="button"
        className="bgo"
        disabled={!okToTrade || busy}
        onClick={handleTrade}
      >
        {busy
          ? 'Working…'
          : !ready
            ? needLabel
            : side === 'buy'
              ? `Buy ${token.symbol}`
              : `Sell ${token.symbol}`}
      </button>

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

      <a className="tp-foot sm" href={`#/sniper?ca=${token.address}`}>
        Open in Sniper
      </a>
    </section>
  );
}
