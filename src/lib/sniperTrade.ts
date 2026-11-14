import {
  SC_CONST,
  SEL,
  type TokenRoute,
  aggregate3Data,
  allowanceData,
  applySlippage,
  balanceData,
  curveBuy,
  curveCalls,
  curveQuoteBuy,
  curveQuoteSell,
  curveSell,
  decString,
  decodeAggregate3,
  decodeCurve,
  decodeLaunched,
  erc20Approve,
  feeOf,
  launchedData,
  makeRoute,
  p2AllowanceData,
  p2Approve,
  poolBuy,
  poolQuoteData,
  poolSell,
  words,
  MAX_U160,
  MAX_U256,
} from './sniperCore';
import { rhCall, rhRpc, walletManager } from './walletManager';

export const SNIPER_CFG_KEY = 'ps_sniper_cfg';

export interface SniperSettings {
  quick: string[];
  sells: number[];
  slip: number;
}

export const DEFAULT_SNIPER_CFG: SniperSettings = {
  quick: ['0.01', '0.05', '0.1', '0.25'],
  sells: [25, 50, 75, 100],
  slip: 10,
};

export function loadSniperCfg(): SniperSettings {
  try {
    const c = JSON.parse(localStorage.getItem(SNIPER_CFG_KEY) || 'null');
    if (c && Array.isArray(c.quick) && c.quick.length === 4) {
      return {
        quick: c.quick,
        sells: Array.isArray(c.sells) && c.sells.length === 4 ? c.sells : DEFAULT_SNIPER_CFG.sells.slice(),
        slip: typeof c.slip === 'number' && c.slip > 0 ? c.slip : DEFAULT_SNIPER_CFG.slip,
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    quick: DEFAULT_SNIPER_CFG.quick.slice(),
    sells: DEFAULT_SNIPER_CFG.sells.slice(),
    slip: DEFAULT_SNIPER_CFG.slip,
  };
}

export function saveSniperCfg(c: SniperSettings) {
  try {
    localStorage.setItem(SNIPER_CFG_KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}

export function toUnits(s: string, d = 18): bigint {
  const clean = String(s || '').trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') return 0n;
  const [i, f = ''] = clean.split('.');
  const frac = f.slice(0, d).padEnd(d, '0');
  return BigInt(i || '0') * 10n ** BigInt(d) + BigInt(frac || '0');
}

export function fmtUnits(v: bigint, d = 18, max = 4): string {
  const val = BigInt(v);
  const b = 10n ** BigInt(d);
  const i = val / b;
  let f = (val % b).toString().padStart(d, '0').slice(0, max).replace(/0+$/, '');
  if (i === 0n && !f && val > 0n) {
    const full = (val % b).toString().padStart(d, '0');
    const nz = full.search(/[1-9]/);
    f = full.slice(0, Math.min(d, (nz >= 0 ? nz : 0) + 3)).replace(/0+$/, '');
  }
  return i.toLocaleString('en-US') + (f ? '.' + f : '');
}

export function fmtTokUnits(v: bigint, d = 18): string {
  const n = Number(v) / 10 ** d;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return fmtUnits(v, d, 4);
}

export function tradeErrMsg(e: any): string {
  if (e && (e.code === 4001 || e.code === 'ACTION_REJECTED')) {
    return 'Request rejected in wallet.';
  }
  const m = String((e && ((e.data && e.data.message) || e.message)) || 'Something went wrong.');
  if (/insufficient funds/i.test(m)) return 'Not enough ETH for this trade and gas.';
  if (/Slippage|0x7dd37f70|TooLittle|minTokensOut|min/i.test(m) && /revert/i.test(m)) {
    return 'Price moved more than your slippage. Try again or raise slippage.';
  }
  return m.replace(/^execution reverted:?\s*/i, 'Transaction would fail: ').slice(0, 200);
}

const multiCall = async (calls: Array<{ to: string; data: string }>) =>
  decodeAggregate3(await rhCall(SC_CONST.multicall3, aggregate3Data(calls)));

export async function loadOnChainToken(addrRaw: string): Promise<TokenRoute> {
  const addr = addrRaw.toLowerCase();
  const L = decodeLaunched(await rhCall(SC_CONST.factory, launchedData(addr)));
  if (!L || !L.exists) return { token: addr, stage: 'unsupported', why: 'Not a Pons token' };
  const res = await multiCall([
    ...curveCalls(L.curve),
    { to: addr, data: SEL.symbol },
    { to: addr, data: SEL.name },
    { to: addr, data: SEL.decimals },
  ]);
  const cs = decodeCurve(res);
  const r = makeRoute(addr, L, cs);
  r.cs = cs;
  r.symbol = res[7]?.ok ? decString(res[7].data) : 'TOKEN';
  r.name = res[8]?.ok ? decString(res[8].data) : r.symbol;
  r.decimals = res[9]?.ok ? Number(words(res[9].data)[0]) : 18;
  return r;
}

export async function refreshCurveRoute(r: TokenRoute): Promise<TokenRoute> {
  if (r.stage !== 'curve' || !r.curve) return r;
  const cs = decodeCurve(await multiCall(curveCalls(r.curve)));
  const n = makeRoute(r.token, r.launch || null, cs);
  return Object.assign(r, { stage: n.stage, cs });
}

export interface TradeQuote {
  side: 'buy' | 'sell';
  amount: bigint;
  out: bigint;
  refund?: bigint;
  impact: number | null;
  gross?: bigint;
}

export async function quoteOnChain(
  r: TokenRoute,
  side: 'buy' | 'sell',
  amount: bigint
): Promise<TradeQuote | null> {
  const amt = BigInt(amount);
  if (amt <= 0n) return null;
  if (r.stage === 'curve') {
    await refreshCurveRoute(r);
    if (r.stage !== 'curve' || !r.cs) return null;
    if (side === 'buy') {
      const q = curveQuoteBuy(r.cs, amt);
      const spot = Number(r.cs.quoteReserve) / Number(r.cs.tokenReserve);
      const eff = Number(amt - q.fee - q.refund) / Number(q.out || 1n);
      return {
        side,
        amount: amt,
        out: q.out,
        refund: q.refund,
        impact: q.out > 0n && spot > 0 ? Math.max(0, eff / spot - 1) : null,
      };
    }
    const q = curveQuoteSell(r.cs, amt);
    const spot = Number(r.cs.quoteReserve) / Number(r.cs.tokenReserve);
    const eff = Number(q.gross + q.ponsFee + q.tax) / Number(amt);
    return {
      side,
      amount: amt,
      out: q.out,
      impact: spot > 0 ? Math.max(0, 1 - eff / spot) : null,
    };
  }
  if (r.stage === 'pool') {
    if (side === 'buy') {
      const net = amt - feeOf(amt);
      const out = words(await rhCall(SC_CONST.quoter, poolQuoteData(r, 'buy', net)))[0] || 0n;
      return { side, amount: amt, out, impact: null };
    }
    const g = words(await rhCall(SC_CONST.quoter, poolQuoteData(r, 'sell', amt)))[0] || 0n;
    return { side, amount: amt, out: g - feeOf(g), gross: g, impact: null };
  }
  return null;
}

export async function fetchOnChainBalances(token: string, who: string): Promise<{ eth: bigint; tok: bigint }> {
  const [res, ethHex] = await Promise.all([
    multiCall([{ to: token, data: balanceData(who) }]),
    rhRpc('eth_getBalance', [who, 'latest']),
  ]);
  return {
    eth: BigInt(ethHex),
    tok: res[0]?.ok ? words(res[0].data)[0] || 0n : 0n,
  };
}

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);

export async function executeBuy(
  r: TokenRoute,
  gross: bigint,
  slipBps: number,
  statusCb: (s: string) => void
): Promise<string> {
  const q = await quoteOnChain(r, 'buy', gross);
  if (!q || q.out <= 0n) {
    throw new Error(
      r.stage === 'graduating' ? 'Graduating to its pool. Try again in a moment.' : 'No quote for this amount.'
    );
  }
  const min = applySlippage(q.out, slipBps);
  const tx = r.stage === 'curve' ? curveBuy(r, gross, min) : poolBuy(r, gross, min, deadline());
  return walletManager.sendTradeTx(tx, statusCb, 'Buy ' + (r.symbol || 'Token'));
}

export async function executeSell(
  r: TokenRoute,
  amount: bigint,
  slipBps: number,
  statusCb: (s: string) => void
): Promise<string> {
  const acct = walletManager.activeAccount();
  if (!acct) throw new Error('Connect or unlock a wallet first.');
  const q = await quoteOnChain(r, 'sell', amount);
  if (!q || q.out <= 0n) {
    throw new Error(
      r.stage === 'graduating' ? 'Graduating to its pool. Try again in a moment.' : 'No quote for this amount.'
    );
  }
  const min = applySlippage(q.out, slipBps);

  if (r.stage === 'curve') {
    const al = words(await rhCall(r.token, allowanceData(acct, SC_CONST.router)))[0] || 0n;
    if (al < amount) {
      statusCb('Approve ' + (r.symbol || 'Token'));
      await walletManager.sendTradeTx(
        { to: r.token, data: erc20Approve(SC_CONST.router, MAX_U256) },
        (s) => statusCb('Approve: ' + s.toLowerCase()),
        'Approve ' + (r.symbol || 'Token')
      );
    }
    return walletManager.sendTradeTx(curveSell(r, amount, min), statusCb, 'Sell ' + (r.symbol || 'Token'));
  }

  const al = words(await rhCall(r.token, allowanceData(acct, SC_CONST.permit2)))[0] || 0n;
  if (al < amount) {
    await walletManager.sendTradeTx(
      { to: r.token, data: erc20Approve(SC_CONST.permit2, MAX_U256) },
      (s) => statusCb('Approve: ' + s.toLowerCase()),
      'Approve Permit2'
    );
  }
  const pw = words(await rhCall(SC_CONST.permit2, p2AllowanceData(acct, r.token, SC_CONST.ur)));
  if ((pw[0] || 0n) < amount || Number(pw[1] || 0n) < Date.now() / 1000 + 120) {
    await walletManager.sendTradeTx(
      {
        to: SC_CONST.permit2,
        data: p2Approve(r.token, SC_CONST.ur, MAX_U160, BigInt(Math.floor(Date.now() / 1000) + 30 * 86400)),
      },
      (s) => statusCb('Permit: ' + s.toLowerCase()),
      'Permit2 Approve'
    );
  }
  return walletManager.sendTradeTx(poolSell(r, amount, min, deadline()), statusCb, 'Sell ' + (r.symbol || 'Token'));
}
