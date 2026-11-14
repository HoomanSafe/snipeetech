import { SITE_CONFIG } from '../config/siteConfig';

const Z = '0x0000000000000000000000000000000000000000';

export const SC_CONST = {
  chainId: SITE_CONFIG.CHAIN_ID,
  rpc: SITE_CONFIG.RPC_URL,
  explorer: SITE_CONFIG.EXPLORER,
  factory: '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
  hook: '0xe5e702641ea86f4ae6cc3cdaed2b886f976be044',
  router: SITE_CONFIG.SNIPER_ROUTER.toLowerCase(),
  ur: '0x8876789976decbfcbbbe364623c63652db8c0904',
  quoter: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94',
  permit2: '0x000000000022d473030f116ddee9f6b43ac78ba3',
  multicall3: '0xca11bde05977b3631167028862be2a173976ca11',
  eth: Z,
  fee: {
    bps: 100,
    recipient: '0x311d209fe9b7e7ebfc36cd9dd03c3cf6cf79a8bd',
  },
} as const;

export const SEL = {
  getLaunched: '0x3cf28b5a',
  routerBuy: '0xcce7ec13',
  routerSell: '0x6a272462',
  getReserves: '0x0902f1ac',
  sellable: '0x808bcddc',
  feeBps: '0x24a9d853',
  creatorTax: '0xc1bb8901',
  graduated: '0xe7c2b772',
  ready: '0xc68360a5',
  native: '0xdc08e094',
  snipeTax: '0xd7e1ef39',
  quoteSingle: '0xaa9d21cb',
  execute: '0x3593564c',
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  balanceOf: '0x70a08231',
  allowance: '0xdd62ed3e',
  approve: '0x095ea7b3',
  p2allowance: '0x927da105',
  p2approve: '0x87517c45',
  aggregate3: '0x82ad56cb',
} as const;

export const CMD = {
  SWEEP: '04',
  TRANSFER: '05',
  PAY_PORTION: '06',
  V4_SWAP: '10',
} as const;

export const ACT = {
  SWAP_EXACT_IN_SINGLE: '06',
  SETTLE_ALL: '0c',
  TAKE: '0e',
  TAKE_ALL: '0f',
} as const;

export const MSG_SENDER = '0x0000000000000000000000000000000000000001';
export const ADDRESS_THIS = '0x0000000000000000000000000000000000000002';
export const MAX_U128 = (1n << 128n) - 1n;
export const MAX_U160 = (1n << 160n) - 1n;
export const MAX_U256 = (1n << 256n) - 1n;

export const strip = (h: string) => String(h || '').replace(/^0x/, '');
export const lc = (a: string) => String(a || '').toLowerCase();

function w(v: bigint | number): string {
  let b = BigInt(v);
  if (b < 0n) b = (1n << 256n) + b;
  if (b < 0n || b > MAX_U256) throw new Error('abi: out of range');
  return b.toString(16).padStart(64, '0');
}

export function wa(a: string): string {
  const s = strip(a).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(s)) throw new Error('abi: bad address ' + a);
  return s.padStart(64, '0');
}

type AbiType = string | ['tuple', AbiType[]] | ['array', AbiType];

const isDyn = (t: AbiType): boolean =>
  t === 'bytes' ||
  (Array.isArray(t) && (t[0] === 'array' || (t[0] === 'tuple' && t[1].some(isDyn))));

function encOne(t: AbiType, v: any): string {
  if (t === 'address') return wa(v);
  if (t === 'uint' || t === 'int') return w(v);
  if (t === 'bool') return w(v ? 1 : 0);
  if (t === 'bytes') {
    const b = strip(v);
    if (b.length % 2) throw new Error('abi: odd bytes');
    return w(b.length / 2) + b.padEnd(Math.ceil(b.length / 64) * 64, '0');
  }
  if (Array.isArray(t) && t[0] === 'tuple') return encTuple(t[1], v);
  if (Array.isArray(t) && t[0] === 'array') {
    return w(v.length) + encTuple(v.map(() => t[1]), v);
  }
  throw new Error('abi: unknown type');
}

const headSize = (t: AbiType): number =>
  Array.isArray(t) && t[0] === 'tuple' && !isDyn(t)
    ? t[1].reduce((n, x) => n + headSize(x), 0)
    : 32;

function encTuple(types: AbiType[], vals: any[]): string {
  const heads: Array<string | null> = [];
  const tails: string[] = [];
  const size = types.reduce((n, t) => n + headSize(t), 0);
  types.forEach((t, i) => {
    if (isDyn(t)) {
      heads.push(null);
      tails.push(encOne(t, vals[i]));
    } else {
      heads.push(encOne(t, vals[i]));
      tails.push('');
    }
  });
  let out = '';
  let tail = '';
  types.forEach((_t, i) => {
    if (heads[i] === null) {
      out += w(size + tail.length / 2);
      tail += tails[i];
    } else {
      out += heads[i];
    }
  });
  return out + tail;
}

export const encode = (types: AbiType[], vals: any[]) => encTuple(types, vals);

export const words = (h: string): bigint[] => {
  const clean = strip(h);
  const o: bigint[] = [];
  for (let i = 0; i + 64 <= clean.length; i += 64) {
    o.push(BigInt('0x' + clean.slice(i, i + 64)));
  }
  return o;
};

export const wordAddr = (x: bigint) => '0x' + BigInt(x).toString(16).padStart(40, '0').slice(-40);

export const toInt = (v: bigint, bits: number): bigint => {
  const val = BigInt(v) & ((1n << BigInt(bits)) - 1n);
  return val >= 1n << BigInt(bits - 1) ? val - (1n << BigInt(bits)) : val;
};

export function decString(h: string): string {
  const clean = strip(h);
  if (!clean) return '';
  try {
    if (clean.length === 64) {
      let s = '';
      for (let i = 0; i < 64; i += 2) {
        const c = parseInt(clean.slice(i, i + 2), 16);
        if (!c) break;
        s += String.fromCharCode(c);
      }
      return s;
    }
    const off = Number(BigInt('0x' + clean.slice(0, 64))) * 2;
    const len = Number(BigInt('0x' + clean.slice(off, off + 64)));
    const bytes = clean.slice(off + 64, off + 64 + len * 2);
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      arr[i] = parseInt(bytes.slice(i * 2, i * 2 + 2), 16);
    }
    return new TextDecoder().decode(arr);
  } catch {
    return '';
  }
}

export interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

const KEY_T: AbiType = ['tuple', ['address', 'address', 'uint', 'int', 'address']];
const keyArr = (k: PoolKey) => [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks];

const feeBps = () => BigInt(SC_CONST.fee.bps || 0);
export const feeOf = (gross: bigint | number) => (BigInt(gross) * feeBps()) / 10000n;
export const applySlippage = (amt: bigint, bps: number) =>
  (BigInt(amt) * BigInt(10000 - Math.round(bps))) / 10000n;

export interface LaunchedInfo {
  token: string;
  curve: string;
  deployer: string;
  pairToken: string;
  threshold: bigint;
  poolFee: number;
  tickSpacing: number;
  creatorTaxBps: number;
  phase: number;
  exists: boolean;
}

export interface CurveState {
  quoteReserve: bigint;
  tokenReserve: bigint;
  sellable: bigint;
  feeBps: bigint;
  taxBps: bigint;
  graduated: boolean;
  ready: boolean;
  native: boolean;
}

export interface TokenRoute {
  token: string;
  stage: 'curve' | 'pool' | 'graduating' | 'unsupported';
  why?: string;
  curve?: string;
  launch?: LaunchedInfo;
  key?: PoolKey;
  cs?: CurveState;
  symbol?: string;
  name?: string;
  decimals?: number;
}

export const launchedData = (token: string) => SEL.getLaunched + wa(token);

export function decodeLaunched(h: string): LaunchedInfo | null {
  const W = words(h);
  if (W.length < 15) return null;
  return {
    token: wordAddr(W[0]),
    curve: wordAddr(W[1]),
    deployer: wordAddr(W[2]),
    pairToken: wordAddr(W[4]),
    threshold: W[5],
    poolFee: Number(W[6]),
    tickSpacing: Number(toInt(W[7], 24)),
    creatorTaxBps: Number(W[8]),
    phase: Number(W[10]),
    exists: W[14] === 1n,
  };
}

export const curveCalls = (curve: string) =>
  [SEL.getReserves, SEL.sellable, SEL.feeBps, SEL.creatorTax, SEL.graduated, SEL.ready, SEL.native].map(
    (d) => ({ to: curve, data: d })
  );

export function decodeCurve(res: Array<{ ok: boolean; data: string }>): CurveState {
  const v = (i: number) => (res[i] && res[i].ok ? words(res[i].data) : []);
  const r = v(0);
  return {
    quoteReserve: r[0] || 0n,
    tokenReserve: r[1] || 0n,
    sellable: v(1)[0] || 0n,
    feeBps: v(2)[0] || 0n,
    taxBps: v(3)[0] || 0n,
    graduated: v(4)[0] === 1n,
    ready: v(5)[0] === 1n,
    native: v(6)[0] === 1n,
  };
}

export function makeRoute(token: string, L: LaunchedInfo | null, cs: CurveState | null): TokenRoute {
  const addr = lc(token);
  if (!L || !L.exists) return { token: addr, stage: 'unsupported', why: 'Not a Pons token' };
  if (L.pairToken !== Z) {
    return { token: addr, stage: 'unsupported', why: 'Quoted in another token, not ETH' };
  }
  const key: PoolKey = {
    currency0: Z,
    currency1: addr,
    fee: L.poolFee,
    tickSpacing: L.tickSpacing,
    hooks: SC_CONST.hook,
  };
  const base = { token: addr, curve: L.curve, launch: L, key };
  if (cs && cs.graduated) return { ...base, stage: 'pool' };
  if (cs && (cs.ready || cs.sellable === 0n)) return { ...base, stage: 'graduating', cs };
  return { ...base, stage: 'curve', cs: cs || undefined };
}

const cpOut = (inp: bigint, rIn: bigint, rOut: bigint) =>
  inp <= 0n || rIn <= 0n || rOut <= 0n ? 0n : (inp * rOut) / (rIn + inp);

export function curveQuoteBuy(cs: CurveState, grossInput: bigint | number) {
  const gross = BigInt(grossInput);
  const fee = feeOf(gross);
  let n = gross - fee;
  if (n <= 0n) return { out: 0n, fee, ponsFee: 0n, tax: 0n, refund: 0n, completes: false };
  let pf = (n * cs.feeBps) / 10000n;
  let tx = (n * cs.taxBps) / 10000n;
  let out = cpOut(n - pf - tx, cs.quoteReserve, cs.tokenReserve);
  let refund = 0n;
  if (out > cs.sellable) {
    out = cs.sellable;
    const s = cs.sellable;
    const q = cs.quoteReserve;
    const t = cs.tokenReserve;
    const keep = 10000n - cs.feeBps - cs.taxBps;
    const need = s <= 0n || q <= 0n || t <= s ? 0n : (s * q) / (t - s) + 1n;
    const max = (need * 10000n + keep - 1n) / keep;
    if (max < n) {
      refund = n - max;
      n = max;
    }
    pf = (n * cs.feeBps) / 10000n;
    tx = (n * cs.taxBps) / 10000n;
  }
  return { out, fee, ponsFee: pf, tax: tx, refund, completes: out >= cs.sellable };
}

export function curveQuoteSell(cs: CurveState, tokensInput: bigint | number) {
  const tokensIn = BigInt(tokensInput);
  const g = cpOut(tokensIn, cs.tokenReserve, cs.quoteReserve);
  const pf = (g * cs.feeBps) / 10000n;
  const tx = (g * cs.taxBps) / 10000n;
  const gross = g - pf - tx;
  const fee = feeOf(gross);
  return { out: gross - fee, gross, fee, ponsFee: pf, tax: tx };
}

export function curveBuy(r: TokenRoute, gross: bigint, minOut: bigint) {
  if (!/^0x[0-9a-f]{40}$/.test(SC_CONST.router)) throw new Error('Sniper router not set');
  if (!r.curve) throw new Error('Curve address missing');
  return {
    to: SC_CONST.router,
    value: BigInt(gross),
    data: SEL.routerBuy + encode(['address', 'uint'], [r.curve, BigInt(minOut)]),
    fee: feeOf(gross),
  };
}

export function curveSell(r: TokenRoute, tokensIn: bigint, minOut: bigint) {
  if (!/^0x[0-9a-f]{40}$/.test(SC_CONST.router)) throw new Error('Sniper router not set');
  if (!r.curve) throw new Error('Curve address missing');
  return {
    to: SC_CONST.router,
    value: 0n,
    data: SEL.routerSell + encode(['address', 'uint', 'uint'], [r.curve, BigInt(tokensIn), BigInt(minOut)]),
  };
}

const exactInSingle = (key: PoolKey, zfo: boolean, amountIn: bigint, minOut: bigint) =>
  encode([['tuple', [KEY_T, 'bool', 'uint', 'uint', 'uint', 'bytes']]], [
    [keyArr(key), zfo, amountIn, minOut, 0n, '0x'],
  ]);

const v4 = (actions: string, params: string[]) =>
  '0x' + encode(['bytes', ['array', 'bytes']], ['0x' + actions, params.map((x) => '0x' + x)]);

const execute = (cmds: string, inputs: string[], deadline: bigint) =>
  SEL.execute + encode(['bytes', ['array', 'bytes'], 'uint'], ['0x' + cmds, inputs, deadline]);

const tri = (a: string, b: string, n: bigint) => '0x' + encode(['address', 'address', 'uint'], [a, b, n]);

export function poolBuy(r: TokenRoute, grossInput: bigint, minOutInput: bigint, deadline: bigint) {
  if (!r.key) throw new Error('Pool key missing');
  const gross = BigInt(grossInput);
  const minOut = BigInt(minOutInput);
  const fee = feeOf(gross);
  const net = gross - fee;
  if (net <= 0n || net > MAX_U128) throw new Error('Amount out of range');
  let cmds = '';
  const inputs: string[] = [];
  if (fee > 0n) {
    cmds += CMD.TRANSFER;
    inputs.push(tri(SC_CONST.eth, SC_CONST.fee.recipient, fee));
  }
  cmds += CMD.V4_SWAP;
  inputs.push(
    v4(ACT.SWAP_EXACT_IN_SINGLE + ACT.SETTLE_ALL + ACT.TAKE_ALL, [
      exactInSingle(r.key, true, net, minOut),
      encode(['address', 'uint'], [SC_CONST.eth, net]),
      encode(['address', 'uint'], [r.token, minOut]),
    ])
  );
  return { to: SC_CONST.ur, value: gross, data: execute(cmds, inputs, deadline), fee, net };
}

export function poolSell(r: TokenRoute, amountInInput: bigint, minNetInput: bigint, deadline: bigint) {
  if (!r.key) throw new Error('Pool key missing');
  const amountIn = BigInt(amountInInput);
  const minNet = BigInt(minNetInput);
  if (amountIn <= 0n || amountIn > MAX_U128) throw new Error('Amount out of range');
  const keep = 10000n - feeBps();
  const minGross = keep > 0n ? (minNet * 10000n + keep - 1n) / keep : minNet;
  let cmds: string = CMD.V4_SWAP;
  const inputs: string[] = [
    v4(ACT.SWAP_EXACT_IN_SINGLE + ACT.SETTLE_ALL + ACT.TAKE, [
      exactInSingle(r.key, false, amountIn, minGross),
      encode(['address', 'uint'], [r.token, amountIn]),
      encode(['address', 'address', 'uint'], [SC_CONST.eth, ADDRESS_THIS, 0n]),
    ]),
  ];
  if (feeBps() > 0n) {
    cmds += CMD.PAY_PORTION;
    inputs.push(tri(SC_CONST.eth, MSG_SENDER, keep));
  }
  cmds += CMD.SWEEP;
  inputs.push(tri(SC_CONST.eth, feeBps() > 0n ? SC_CONST.fee.recipient : MSG_SENDER, 0n));
  return { to: SC_CONST.ur, value: 0n, data: execute(cmds, inputs, deadline), minGross };
}

export const poolQuoteData = (r: TokenRoute, side: 'buy' | 'sell', amount: bigint) => {
  if (!r.key) throw new Error('Pool key missing');
  return (
    SEL.quoteSingle +
    encode([['tuple', [KEY_T, 'bool', 'uint', 'bytes']]], [
      [keyArr(r.key), side === 'buy', BigInt(amount), '0x'],
    ])
  );
};

export const erc20Approve = (spender: string, amt: bigint) =>
  SEL.approve + encode(['address', 'uint'], [spender, amt]);

export const p2Approve = (token: string, spender: string, amt: bigint, exp: bigint) =>
  SEL.p2approve +
  encode(['address', 'address', 'uint', 'uint'], [token, spender, amt > MAX_U160 ? MAX_U160 : amt, exp]);

export const p2AllowanceData = (owner: string, token: string, spender: string) =>
  SEL.p2allowance + encode(['address', 'address', 'address'], [owner, token, spender]);

export const balanceData = (a: string) => SEL.balanceOf + wa(a);
export const allowanceData = (o: string, s: string) => SEL.allowance + wa(o) + wa(s);

export const aggregate3Data = (calls: Array<{ to: string; data: string }>) =>
  SEL.aggregate3 +
  encode([['array', ['tuple', ['address', 'bool', 'bytes']]]], [calls.map((c) => [c.to, true, c.data])]);

export function decodeAggregate3(h: string): Array<{ ok: boolean; data: string }> {
  const clean = strip(h);
  const at = (o: number) => Number(BigInt('0x' + clean.slice(o * 2, o * 2 + 64)));
  const base = at(0);
  const n = at(base);
  const out: Array<{ ok: boolean; data: string }> = [];
  for (let i = 0; i < n; i++) {
    const eo = base + 32 + at(base + 32 + i * 32);
    const ok = at(eo) === 1;
    const bo = eo + at(eo + 32);
    const len = at(bo);
    out.push({ ok, data: '0x' + clean.slice((bo + 32) * 2, (bo + 32 + len) * 2) });
  }
  return out;
}
