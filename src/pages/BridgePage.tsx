import { useEffect, useRef, useState } from 'react';
import { SITE_CONFIG } from '../config/siteConfig';
import { RH_CHAIN_PARAMS, walletManager } from '../lib/walletManager';

const RH = 4663;
const NATIVE = '0x0000000000000000000000000000000000000000';
const PLACEHOLDER_USER = '0x000000000000000000000000000000000000dEaD';
const ETH_ICON = 'https://assets.relay.link/icons/currencies/eth.png';
const RH_TX = 'https://robin.etherscan.io/tx/';
const CURATED = [8453, 1, 42161, 10, 130, 59144, 57073, 534352];
const IMPACT_WARN = 2;
const IMPACT_HIGH = 5;

const RH_TOKENS: Record<string, { symbol: string; address: string; decimals: number; logo?: string }> = {
  ETH: { symbol: 'ETH', address: NATIVE, decimals: 18, logo: ETH_ICON },
  USDG: {
    symbol: 'USDG',
    address: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
    decimals: 6,
    logo: 'https://assets.coingecko.com/coins/images/51281/standard/GDN_USDG_Token_200x200.png',
  },
};

const hex = (n: bigint | number) => '0x' + BigInt(n).toString(16);

function toUnits(s: string, d: number): bigint {
  const clean = String(s || '').trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') return 0n;
  const [i, f = ''] = clean.split('.');
  const frac = (f + '0'.repeat(d)).slice(0, d);
  return BigInt(i || '0') * 10n ** BigInt(d) + BigInt(frac || '0');
}

function fromUnits(v: bigint, d: number, max = 6): string {
  let val = BigInt(v);
  const neg = val < 0n;
  if (neg) val = -val;
  const b = 10n ** BigInt(d);
  const i = val / b;
  const f = (val % b).toString().padStart(d, '0').slice(0, max).replace(/0+$/, '');
  return (neg ? '-' : '') + i.toLocaleString('en-US') + (f ? '.' + f : '');
}

function fmtNum(s: string | number | undefined, max = 6): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return n.toLocaleString('en-US', { maximumSignificantDigits: max });
}

const usd = (s: string | number | undefined) => {
  const n = Number(s);
  return Number.isFinite(n) ? (n < 0.01 && n > 0 ? '<$0.01' : '$' + n.toFixed(2)) : '—';
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRelayJson(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  let d: any = null;
  try {
    d = await r.json();
  } catch {
    // ignore
  }
  if (!r.ok) {
    const e: any = new Error((d && (d.message || d.error)) || 'HTTP ' + r.status);
    e.status = r.status;
    e.code = d && d.errorCode;
    throw e;
  }
  return d;
}

export function BridgePage({ onOpenWallet }: { onOpenWallet: () => void }) {
  const [chainsMap, setChainsMap] = useState<Map<number, any> | null>(null);
  const [chainErr, setChainErr] = useState('');
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [other, setOther] = useState<number>(8453);
  const [fromSym, setFromSym] = useState('ETH');
  const [toSym, setToSym] = useState('ETH');
  const [amount, setAmount] = useState('0.1');
  const [slip, setSlip] = useState<'auto' | '0.5' | '1' | '3'>('auto');
  const [quote, setQuote] = useState<any>(null);
  const [qErr, setQErr] = useState('');
  const [qLoading, setQLoading] = useState(false);
  const [ack, setAck] = useState(false);
  const [bal, setBal] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Array<{ chainId: number; hash: string; label: string }>>([]);
  const [status, setStatus] = useState('');
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState('');
  const [, setTick] = useState(0);
  const qSeq = useRef(0);

  useEffect(() => {
    document.title = `Bridge to Robinhood Chain — ${SITE_CONFIG.PROJECT_NAME}`;
    const unsub = walletManager.subscribe(() => setTick((t) => t + 1));
    walletManager.requestWallets();
    fetchRelayJson('/api/relay?ep=chains')
      .then((d) => {
        const map = new Map<number, any>();
        for (const c of d.chains || []) {
          if (!c.disabled && c.depositEnabled && c.vmType === 'evm' && c.currency?.symbol === 'ETH') {
            map.set(c.id, c);
          }
        }
        setChainsMap(map);
        if (!map.has(8453)) {
          const first = CURATED.find((id) => map.has(id));
          if (first) setOther(first);
        }
      })
      .catch(() => setChainErr('Could not load bridge routes from Relay. Please try again later.'));
    return unsub;
  }, []);

  const others = () =>
    chainsMap ? CURATED.filter((id) => chainsMap.has(id)).map((id) => chainsMap.get(id)) : [];

  const getToken = (chainId: number, sym: string) => {
    if (sym === 'ETH') return { symbol: 'ETH', address: NATIVE, decimals: 18, logo: ETH_ICON };
    if (chainId === RH) return RH_TOKENS[sym] || null;
    const c = chainsMap?.get(chainId);
    const t = c?.erc20Currencies?.find((x: any) => x.symbol === sym);
    if (!t) return null;
    const f = c?.featuredTokens?.find((x: any) => x.symbol === sym);
    return { symbol: t.symbol, address: t.address, decimals: t.decimals, logo: f?.metadata?.logoURI };
  };

  const fromChain = dir === 'in' ? other : RH;
  const toChain = dir === 'in' ? RH : other;
  const fromToken = getToken(fromChain, fromSym);
  const toToken = getToken(toChain, toSym);

  const fromSyms = () =>
    dir === 'in' ? ['ETH', 'USDC'].filter((s) => getToken(other, s)) : ['ETH', 'USDG'];
  const toSyms = () =>
    dir === 'in' ? ['ETH', 'USDG'] : ['ETH', 'USDC'].filter((s) => getToken(other, s));

  const rpcUrl = (id: number) =>
    id === RH ? RH_CHAIN_PARAMS.rpcUrls[0] : chainsMap?.get(id)?.httpRpcUrl;
  const explorer = (id: number) =>
    id === RH ? 'https://robin.etherscan.io' : chainsMap?.get(id)?.explorerUrl || '';
  const chainName = (id: number) =>
    id === RH ? 'Robinhood Chain' : chainsMap?.get(id)?.displayName || `Chain ${id}`;
  const chainIcon = (id: number) => `https://assets.relay.link/icons/${id}/light.png`;

  const rpcOnChain = async (chainId: number, method: string, params: any[]) => {
    if (walletManager.extProvider && walletManager.extChainId === chainId) {
      return walletManager.extProvider.request({ method, params });
    }
    const u = rpcUrl(chainId);
    if (!u) throw new Error('No RPC');
    const d = await fetchRelayJson(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (d.error) throw new Error(d.error.message);
    return d.result;
  };

  // Load origin balance
  useEffect(() => {
    const acct = walletManager.extAccount;
    if (!acct || !fromToken || !chainsMap) {
      setBal(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        let b: bigint;
        if (fromToken.address === NATIVE) {
          b = BigInt(await rpcOnChain(fromChain, 'eth_getBalance', [acct, 'latest']));
        } else {
          const res = await rpcOnChain(fromChain, 'eth_call', [
            { to: fromToken.address, data: '0x70a08231' + acct.slice(2).toLowerCase().padStart(64, '0') },
            'latest',
          ]);
          b = BigInt(res && res !== '0x' ? res : 0);
        }
        if (alive) setBal(b);
      } catch {
        if (alive) setBal(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [walletManager.extAccount, walletManager.extChainId, fromChain, fromToken?.address, chainsMap]);

  // Quote debouncer
  const fetchQuoteNow = async () => {
    if (!fromToken || !toToken || !chainsMap) return null;
    const amt = toUnits(amount, fromToken.decimals);
    if (amt <= 0n) {
      setQuote(null);
      setQErr('');
      return null;
    }
    const user = walletManager.extAccount || PLACEHOLDER_USER;
    const body: any = {
      user,
      recipient: user,
      originChainId: fromChain,
      destinationChainId: toChain,
      originCurrency: fromToken.address,
      destinationCurrency: toToken.address,
      amount: amt.toString(),
      tradeType: 'EXACT_INPUT',
    };
    if (slip !== 'auto') body.slippageTolerance = String(Math.round(Number(slip) * 100));
    const seq = ++qSeq.current;
    setQLoading(true);
    try {
      const q = await fetchRelayJson('/api/relay?ep=quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (seq === qSeq.current) {
        setQuote(q);
        setQErr('');
      }
      return q;
    } catch (e: any) {
      if (seq === qSeq.current) {
        setQuote(null);
        setQErr(
          e.code === 'AMOUNT_TOO_LOW'
            ? 'Amount too low for this route.'
            : e.status === 429
              ? 'Too many requests, wait a moment.'
              : e.message || 'Quote unavailable.'
        );
      }
      return null;
    } finally {
      if (seq === qSeq.current) setQLoading(false);
    }
  };

  useEffect(() => {
    if (!chainsMap || busy) return;
    setQuote(null);
    setQErr('');
    setAck(false);
    const timer = setTimeout(() => {
      fetchQuoteNow();
    }, 400);
    return () => clearTimeout(timer);
  }, [dir, other, fromSym, toSym, amount, slip, walletManager.extAccount, chainsMap]);

  const getImpact = (q: any) => {
    const p = Number(q?.details?.totalImpact?.percent);
    const s = Number(q?.details?.swapImpact?.percent);
    const a = Number.isFinite(p) ? Math.abs(p) : 0;
    const b = Number.isFinite(s) ? Math.abs(s) : 0;
    const worst = Math.max(a, b);
    return Number.isFinite(p) || Number.isFinite(s) ? { worst } : null;
  };

  const waitReceipt = async (chainId: number, hash: string) => {
    for (let i = 0; i < 180; i++) {
      let r: any = null;
      try {
        r = await walletManager.extProvider.request({
          method: 'eth_getTransactionReceipt',
          params: [hash],
        });
      } catch {
        // fallback to RPC
      }
      if (!r) {
        try {
          r = await rpcOnChain(chainId, 'eth_getTransactionReceipt', [hash]);
        } catch {
          // retry
        }
      }
      if (r && r.blockNumber) {
        if (r.status === '0x0') throw new Error(`Transaction failed on ${chainName(chainId)}.`);
        return r;
      }
      await sleep(2000);
    }
    throw new Error('Timed out waiting for confirmation.');
  };

  const waitRelay = async (id: string) => {
    for (let i = 0; i < 150; i++) {
      let d: any = null;
      try {
        d = await fetchRelayJson('/api/relay?ep=status&requestId=' + id);
      } catch {
        // retry
      }
      const st = d?.status;
      if (st) {
        setStatus(
          st === 'success'
            ? 'Arrived'
            : st === 'waiting' || st === 'pending' || st === 'submitted'
              ? 'Relay is filling your order…'
              : st === 'delayed'
                ? 'Delayed, still processing…'
                : 'Status: ' + st
        );
      }
      if (st === 'success') return (d.txHashes || []) as string[];
      if (st === 'failure' || st === 'refund' || st === 'refunded') {
        throw new Error(
          st === 'failure'
            ? 'Relay reported a failure. Funds are refunded per Relay rules.'
            : 'Order refunded by Relay.'
        );
      }
      await sleep(2000);
    }
    throw new Error('Still processing. Track it on relay.link.');
  };

  const executeBridge = async () => {
    setBusy(true);
    setErr('');
    setDone(null);
    setSteps([]);
    setStatus('Getting a fresh quote…');
    try {
      const q = await fetchQuoteNow();
      if (!q || !q.steps) throw new Error(qErr || 'No quote');
      const imp = getImpact(q);
      if (imp && imp.worst >= IMPACT_HIGH && !ack) {
        throw new Error('Confirm the price impact first.');
      }
      const txs: Array<{ chainId: number; hash: string; label: string }> = [];
      let requestId: string | null = null;
      let destTxs: string[] = [];

      for (const step of q.steps) {
        if (step.kind !== 'transaction') {
          throw new Error('This route needs a signature step, which is not supported yet. Try ETH.');
        }
        for (const item of step.items || []) {
          if (item.status === 'complete') continue;
          const d = item.data;
          const cid = Number(d.chainId);
          setStatus(`Switching to ${chainName(cid)}…`);
          await walletManager.ensureChain(cid, {
            chainId: hex(cid),
            chainName: chainName(cid),
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: [rpcUrl(cid)],
            blockExplorerUrls: [explorer(cid)],
          });
          const label = step.id === 'approve' ? `Approve ${fromSym}` : 'Bridge';
          setStatus(`${label}: confirm in your wallet`);
          const tx: any = {
            from: walletManager.extAccount,
            to: d.to,
            data: d.data || '0x',
            value: hex(d.value || 0),
            chainId: hex(cid),
          };
          if (d.gas) tx.gas = hex(d.gas);
          const hash = await walletManager.extProvider.request({
            method: 'eth_sendTransaction',
            params: [tx],
          });
          txs.push({ chainId: cid, hash, label });
          setSteps(txs.slice());
          setStatus(`${label}: waiting for confirmation…`);
          await waitReceipt(cid, hash);
          const ep = item.check?.endpoint;
          const m = ep && /requestId=(0x[0-9a-fA-F]{64})/.exec(ep);
          if (m) {
            requestId = m[1];
            destTxs = await waitRelay(m[1]);
          }
        }
      }
      if (!requestId) requestId = q.steps.find((s: any) => s.requestId)?.requestId || null;
      setDone({ txs, requestId, dest: destTxs, fromChain, toChain, out: q.details?.currencyOut });
      setStatus('');
      setAmount('');
      setQuote(null);
    } catch (e: any) {
      const rejected = e && (e.code === 4001 || /reject|denied|cancel/i.test(String(e.message)));
      setErr(rejected ? 'Request rejected in wallet.' : e?.message || 'Something went wrong.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  if (chainErr) {
    return (
      <section className="bridge">
        <div className="berr">{chainErr}</div>
      </section>
    );
  }
  if (!chainsMap) {
    return (
      <section className="bridge">
        <div className="loading">Loading bridge…</div>
      </section>
    );
  }

  const d = quote?.details;
  const imp = getImpact(quote);
  const sev = !imp ? '' : imp.worst >= IMPACT_HIGH ? 'high' : imp.worst >= IMPACT_WARN ? 'warn' : '';
  const fees = quote?.fees || {};
  const outAmt = d?.currencyOut ? fmtNum(d.currencyOut.amountFormatted) : '—';
  const minOut = d?.currencyOut?.minimumAmount ? fmtNum(fromUnits(BigInt(d.currencyOut.minimumAmount), toToken?.decimals || 18)) : '';
  const amtBig = fromToken ? toUnits(amount, fromToken.decimals) : 0n;

  const getBtnState = () => {
    if (busy) return { text: status || 'Working…', dis: true, act: '' };
    if (!walletManager.extAccount) {
      return {
        text: walletManager.walletOptions().length ? 'Connect browser wallet' : 'No wallet detected',
        dis: false,
        act: 'connect',
      };
    }
    if (amtBig <= 0n) return { text: 'Enter an amount', dis: true, act: '' };
    if (bal !== null && amtBig > bal) return { text: `Insufficient ${fromSym} balance`, dis: true, act: '' };
    if (qErr) return { text: 'Quote unavailable', dis: true, act: '' };
    if (!quote) return { text: 'Getting quote…', dis: true, act: '' };
    if (walletManager.extChainId !== fromChain) {
      return { text: `Switch to ${chainName(fromChain)}`, dis: false, act: 'switch' };
    }
    if (imp && imp.worst >= IMPACT_HIGH && !ack) {
      return { text: 'Confirm price impact above', dis: true, act: '' };
    }
    const needsApprove = quote.steps?.some((s: any) => s.id === 'approve');
    const isBuy = dir === 'in' && toSym !== 'ETH';
    return {
      text: (needsApprove ? 'Approve and ' : '') + (isBuy ? `Bridge and buy ${toSym}` : 'Bridge'),
      dis: false,
      act: 'go',
    };
  };

  const btn = getBtnState();

  return (
    <section className="bridge">
      <div className="bhead">
        <div>
          <h1>Bridge</h1>
          <p className="muted">
            Move ETH and USDG to and from Robinhood Chain via Relay.
          </p>
        </div>
        <button
          type="button"
          className={`wbtn ${walletManager.extAccount ? 'on' : ''}`}
          onClick={() => onOpenWallet()}
        >
          {walletManager.extAccount ? (
            <>
              <span className="dot" />
              <span className="mono">
                {walletManager.extAccount.slice(0, 6)}…{walletManager.extAccount.slice(-4)}
              </span>
            </>
          ) : (
            'Connect wallet'
          )}
        </button>
      </div>

      <div className="bcard">
        <div className="bbox">
          <div className="brow">
            <span className="blab">From</span>
            {fromChain === RH ? (
              <div className="bchain fixed">
                <img src={chainIcon(RH)} alt="" width={22} height={22} />
                <span>Robinhood Chain</span>
              </div>
            ) : (
              <label className="bchain">
                <img src={chainIcon(fromChain)} alt="" width={22} height={22} />
                <select
                  value={other}
                  aria-label="From chain"
                  onChange={(e) => {
                    const nextId = Number(e.target.value);
                    setOther(nextId);
                    setFromSym('ETH');
                  }}
                >
                  {others().map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </label>
            )}
          </div>

          <div className="bseg" role="radiogroup">
            {fromSyms().map((s) => {
              const t = getToken(fromChain, s);
              return (
                <button
                  key={s}
                  type="button"
                  className={s === fromSym ? 'on' : ''}
                  onClick={() => {
                    setFromSym(s);
                    setAmount('');
                  }}
                >
                  {t?.logo ? <img className="bti" src={t.logo} alt="" width={20} height={20} /> : null}
                  <span>{s}</span>
                </button>
              );
            })}
          </div>

          <div className="bamt">
            <input
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              disabled={busy}
              aria-label="Amount to bridge"
              onChange={(e) => {
                const v = e.target.value.replace(',', '.');
                if (/^\d*\.?\d*$/.test(v)) setAmount(v);
              }}
            />
            <span className="bsym">{fromSym}</span>
          </div>

          <div className="bbal">
            <span>
              {bal !== null && fromToken
                ? `Balance: ${fromUnits(bal, fromToken.decimals, 5)} ${fromSym}`
                : ''}
            </span>
            {bal !== null && bal > 0n && fromToken ? (
              <button
                type="button"
                onClick={() => {
                  let v = bal;
                  if (fromToken.address === NATIVE) {
                    const reserve = fromChain === 1 ? 3n * 10n ** 15n : 2n * 10n ** 14n;
                    v = v > reserve ? v - reserve : 0n;
                  }
                  setAmount(fromUnits(v, fromToken.decimals, fromToken.decimals).replace(/,/g, ''));
                }}
              >
                Max
              </button>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          className="bflip"
          title="Swap direction"
          aria-label="Swap direction"
          disabled={busy}
          onClick={() => {
            setDir((d0) => (d0 === 'in' ? 'out' : 'in'));
            setFromSym('ETH');
            setToSym('ETH');
            setAmount('');
          }}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />
          </svg>
        </button>

        <div className="bbox">
          <div className="brow">
            <span className="blab">To</span>
            {toChain === RH ? (
              <div className="bchain fixed">
                <img src={chainIcon(RH)} alt="" width={22} height={22} />
                <span>Robinhood Chain</span>
              </div>
            ) : (
              <label className="bchain">
                <img src={chainIcon(toChain)} alt="" width={22} height={22} />
                <select
                  value={other}
                  aria-label="To chain"
                  onChange={(e) => {
                    setOther(Number(e.target.value));
                    setToSym('ETH');
                  }}
                >
                  {others().map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </label>
            )}
          </div>

          <div className="bseg" role="radiogroup">
            {toSyms().map((s) => {
              const t = getToken(toChain, s);
              return (
                <button
                  key={s}
                  type="button"
                  className={s === toSym ? 'on' : ''}
                  onClick={() => setToSym(s)}
                >
                  {t?.logo ? <img className="bti" src={t.logo} alt="" width={20} height={20} /> : null}
                  <span>{s}</span>
                </button>
              );
            })}
          </div>

          <div className="bamt out">
            <span className={qLoading ? 'pulse' : ''}>{outAmt}</span>
            <span className="bsym">{toSym}</span>
          </div>

          {dir === 'in' && toSym !== 'ETH' ? (
            <div className="bnote">
              Bridges your {fromSym} and buys {toSym} on Robinhood Chain in one step.
            </div>
          ) : null}
        </div>

        <div className="bslip">
          <span>Max slippage</span>
          <div className="bseg sm">
            {(['auto', '0.5', '1', '3'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={slip === v ? 'on' : ''}
                onClick={() => setSlip(v)}
              >
                {v === 'auto' ? 'Auto' : `${v}%`}
              </button>
            ))}
          </div>
        </div>

        {quote && d ? (
          <div className="bq">
            <div>
              <span>You receive</span>
              <b className="mono">
                {fmtNum(d.currencyOut.amountFormatted)} {toSym}
              </b>
            </div>
            {minOut ? (
              <div>
                <span>Minimum received</span>
                <span className="mono">
                  {minOut} {toSym}
                </span>
              </div>
            ) : null}
            <div>
              <span>Price impact</span>
              <span className={`mono ${sev}`}>{imp ? `-${imp.worst.toFixed(2)}%` : '—'}</span>
            </div>
            <div>
              <span>Estimated time</span>
              <span>{d.timeEstimate != null ? `~${d.timeEstimate}s` : '—'}</span>
            </div>
            <div>
              <span>Network fee</span>
              <span className="mono">{usd(fees.gas?.amountUsd)}</span>
            </div>
            <div>
              <span>Relay fee</span>
              <span className="mono">{usd(fees.relayer?.amountUsd)}</span>
            </div>
            <div>
              <span>{SITE_CONFIG.PROJECT_NAME} fee</span>
              <span className="mono">$0.00</span>
            </div>
          </div>
        ) : qErr ? (
          <div className="berr">{qErr}</div>
        ) : null}

        {sev === 'high' && imp ? (
          <label className="bwarn high">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              <b>High price impact ({imp.worst.toFixed(2)}%).</b> {toSym} liquidity is thin, so you
              would receive much less than the market price. Tick to continue anyway.
            </span>
          </label>
        ) : sev === 'warn' && imp ? (
          <div className="bwarn">
            Price impact is {imp.worst.toFixed(2)}%. Consider a smaller amount.
          </div>
        ) : null}

        <button
          type="button"
          className="bgo"
          disabled={btn.dis}
          onClick={async () => {
            if (btn.act === 'connect') {
              onOpenWallet();
            } else if (btn.act === 'switch') {
              try {
                await walletManager.ensureChain(fromChain, {
                  chainId: hex(fromChain),
                  chainName: chainName(fromChain),
                  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                  rpcUrls: [rpcUrl(fromChain)],
                  blockExplorerUrls: [explorer(fromChain)],
                });
                setErr('');
              } catch (e: any) {
                setErr(e?.code === 4001 ? 'Network switch rejected.' : e?.message || 'Could not switch network.');
              }
            } else if (btn.act === 'go') {
              executeBridge();
            }
          }}
        >
          {btn.text}
        </button>

        {err ? <div className="berr">{err}</div> : null}

        {busy && steps.length ? (
          <div className="bprog">
            {steps.map((t, i) => (
              <a
                key={`${t.hash}-${i}`}
                href={`${explorer(t.chainId)}/tx/${t.hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.label} tx on {chainName(t.chainId)}
              </a>
            ))}
          </div>
        ) : null}

        {done ? (
          <div className="bdone">
            <div>
              <b>Done.</b>{' '}
              {done.out
                ? `${fmtNum(done.out.amountFormatted)} ${done.out.currency.symbol} sent to ${chainName(done.toChain)}.`
                : ''}
            </div>
            <div className="blinks">
              {done.txs.map((t: any, i: number) => (
                <a
                  key={`${t.hash}-${i}`}
                  href={`${explorer(t.chainId)}/tx/${t.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t.label} tx ({chainName(t.chainId)})
                </a>
              ))}
              {done.dest.map((h: string) => (
                <a
                  key={h}
                  href={done.toChain === RH ? RH_TX + h : `${explorer(done.toChain)}/tx/${h}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Destination tx ({chainName(done.toChain)})
                </a>
              ))}
              {done.requestId ? (
                <a
                  href={`https://relay.link/transaction/${done.requestId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on Relay
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <p className="bfoot">
        Powered by{' '}
        <a href="https://relay.link" target="_blank" rel="noopener noreferrer">
          Relay
        </a>{' '}
        · Non-custodial cross-chain execution
      </p>
    </section>
  );
}
