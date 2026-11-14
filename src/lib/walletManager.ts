import { getAddress, isAddress, keccak256 } from 'viem';
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import QRCode from 'qrcode';
import { SC_CONST } from './sniperCore';
import { SITE_CONFIG } from '../config/siteConfig';

const REC_KEY = 'ps_tw:v1';
const USE_KEY = 'ps_tw_use';
const IDLE_KEY = 'ps_tw_idle';
const MODE_KEY = 'ps_mode';
const EXT_KEY = 'ps_wallet';
const ITER = 600000;
const SECP_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export const RH_CHAIN_PARAMS = {
  chainId: '0x1237',
  chainName: SITE_CONFIG.CHAIN_NAME,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [SITE_CONFIG.RPC_URL],
  blockExplorerUrls: [SITE_CONFIG.EXPLORER],
};

export interface WalletOption {
  info: {
    uuid: string;
    name: string;
    icon: string;
    rdns: string;
  };
  provider: any;
}

interface StoredWalletRecord {
  v: 1;
  address: string;
  origin: 'generated' | 'imported';
  created: number;
  backedUp: boolean;
  enc: {
    kdf: 'PBKDF2-SHA256';
    iter: number;
    salt: string;
    iv: string;
    ct: string;
  };
}

let rpcSeq = 0;

export async function rhRpc(method: string, params: any[]): Promise<any> {
  const r = await fetch(SC_CONST.rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcSeq, method, params }),
  });
  const d = await r.json();
  if (d.error) {
    const e: any = new Error(d.error.message || 'RPC error');
    e.data = d.error.data;
    throw e;
  }
  return d.result;
}

export const rhCall = (to: string, data: string, opts: { from?: string; value?: string } = {}) =>
  rhRpc('eth_call', [{ to, data, ...(opts.from ? { from: opts.from } : {}), ...(opts.value ? { value: opts.value } : {}) }, 'latest']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (n: bigint | number) => '0x' + BigInt(n).toString(16);

const te = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBytes = (h: string) => {
  const s = h.slice(2);
  const u = new Uint8Array(s.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return u;
};
const toHex = (u: Uint8Array) =>
  '0x' + Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');

async function deriveKek(password: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey(
    'raw',
    te.encode(String(password).normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function sealKey(pk: string, password: string, address: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = toBytes(pk);
  try {
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: te.encode(address.toLowerCase()) },
        await deriveKek(password, salt, ITER),
        pt
      )
    );
    return { kdf: 'PBKDF2-SHA256' as const, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  } finally {
    pt.fill(0);
  }
}

async function unsealKey(r: StoredWalletRecord, password: string): Promise<`0x${string}`> {
  let pt: Uint8Array;
  try {
    pt = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: unb64(r.enc.iv), additionalData: te.encode(r.address.toLowerCase()) },
        await deriveKek(password, unb64(r.enc.salt), r.enc.iter),
        unb64(r.enc.ct)
      )
    );
  } catch {
    throw new Error('Wrong password.');
  }
  try {
    const pk = toHex(pt) as `0x${string}`;
    if (privateKeyToAccount(pk).address.toLowerCase() !== r.address.toLowerCase()) {
      throw new Error('Stored wallet is damaged.');
    }
    return pk;
  } finally {
    pt.fill(0);
  }
}

export function parsePrivateKey(s: string): { pk?: `0x${string}`; err?: string } {
  let v = String(s || '').trim().replace(/\s+/g, '');
  if (/^[0-9a-fA-F]{64}$/.test(v)) v = '0x' + v;
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) {
    return {
      err: v
        ? 'A private key is 64 hex characters (0-9, a-f), optionally starting with 0x. Seed phrases are not supported.'
        : '',
    };
  }
  const n = BigInt(v);
  if (n === 0n || n >= SECP_N) return { err: 'This is not a valid secp256k1 private key.' };
  return { pk: v.toLowerCase() as `0x${string}` };
}

function readRec(): StoredWalletRecord | null {
  try {
    const r = JSON.parse(localStorage.getItem(REC_KEY) || 'null');
    return r && r.v === 1 && r.address && r.enc ? r : null;
  } catch {
    return null;
  }
}

function writeRec(r: StoredWalletRecord) {
  localStorage.setItem(REC_KEY, JSON.stringify(r));
}

const fmtEth = (w: bigint) => {
  const n = Number(BigInt(w)) / 1e18;
  if (n === 0) return '0';
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(3).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

class WalletController {
  private subs = new Set<() => void>();
  private acct: PrivateKeyAccount | null = null;
  private pendingPk: string | null = null;
  private nonceNext: bigint | null = null;
  private lockWhy = '';
  private lastAct = Date.now();
  private txQueue: Promise<any> = Promise.resolve();

  // EIP-6963 / injected browser wallet state
  public extList: WalletOption[] = [];
  public extProvider: any = null;
  public extInfo: WalletOption['info'] | null = null;
  public extAccount: string | null = null;
  public extChainId: number | null = null;
  private hookedProviders = new WeakSet<object>();

  public mode: 'tw' | 'ext' = 'tw';

  constructor() {
    if (typeof window !== 'undefined') {
      this.mode = localStorage.getItem(MODE_KEY) === 'ext' ? 'ext' : 'tw';
      window.addEventListener('eip6963:announceProvider', (e: any) => {
        const d = e?.detail;
        if (d && d.info && d.provider && !this.extList.some((x) => x.info.uuid === d.info.uuid)) {
          this.extList.push(d);
          this.emit();
        }
      });
      this.requestWallets();
      window.addEventListener('pagehide', () => this.lock('Locked when the page was closed.'));
      ['pointerdown', 'keydown'].forEach((ev) =>
        window.addEventListener(ev, () => {
          this.lastAct = Date.now();
        }, { capture: true, passive: true })
      );
      setInterval(() => {
        const m = this.idleMin();
        if (this.acct && m && Date.now() - this.lastAct > m * 60000) {
          this.lock(`Locked after ${m >= 60 ? m / 60 + ' h' : m + ' min'} without activity.`);
        }
      }, 15000);
    }
  }

  subscribe(fn: () => void) {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  private emit() {
    this.subs.forEach((f) => {
      try {
        f();
      } catch {
        // ignore listener errors
      }
    });
  }

  setMode(m: 'tw' | 'ext') {
    this.mode = m === 'ext' ? 'ext' : 'tw';
    localStorage.setItem(MODE_KEY, this.mode);
    localStorage.setItem(USE_KEY, this.mode === 'tw' ? '1' : '0');
    this.emit();
  }

  // ---------- Trading wallet ----------
  twExists = () => !!readRec();
  twRec = () => {
    const r = readRec();
    return r ? { address: r.address, origin: r.origin, created: r.created, backedUp: !!r.backedUp } : null;
  };
  twAddress = () => readRec()?.address || null;
  twUnlocked = () => !!this.acct;
  twLockReason = () => this.lockWhy;
  idleMin = () => {
    const v = parseInt(localStorage.getItem(IDLE_KEY) || '0', 10);
    return [0, 15, 60, 240].includes(v) ? v : 0;
  };
  setIdleMin(v: number) {
    localStorage.setItem(IDLE_KEY, String(v));
    this.lastAct = Date.now();
    this.emit();
  }

  checkPassword(pw: string, pw2: string) {
    if (String(pw).length < 10) return 'Use a password of at least 10 characters.';
    if (pw !== pw2) return 'The two passwords do not match.';
    return '';
  }

  async create(password: string) {
    if (readRec()) throw new Error('A trading wallet already exists in this browser. Forget it first.');
    const pk = generatePrivateKey();
    const a = privateKeyToAccount(pk);
    writeRec({
      v: 1,
      address: a.address,
      origin: 'generated',
      created: Date.now(),
      backedUp: false,
      enc: await sealKey(pk, password, a.address),
    });
    this.pendingPk = pk;
    localStorage.setItem(USE_KEY, '1');
    this.mode = 'tw';
    localStorage.setItem(MODE_KEY, 'tw');
    this.setUnlocked(a);
    return a.address;
  }

  async importKey(s: string, password: string) {
    if (readRec()) throw new Error('A trading wallet already exists in this browser. Forget it first.');
    const k = parsePrivateKey(s);
    if (!k.pk) throw new Error(k.err || 'Paste a private key.');
    let a: PrivateKeyAccount;
    try {
      a = privateKeyToAccount(k.pk);
    } catch {
      throw new Error('This is not a valid secp256k1 private key.');
    }
    writeRec({
      v: 1,
      address: a.address,
      origin: 'imported',
      created: Date.now(),
      backedUp: true,
      enc: await sealKey(k.pk, password, a.address),
    });
    localStorage.setItem(USE_KEY, '1');
    this.mode = 'tw';
    localStorage.setItem(MODE_KEY, 'tw');
    this.setUnlocked(a);
    return a.address;
  }

  backupKey = () => (this.acct && this.pendingPk ? this.pendingPk : null);

  confirmBackup() {
    const r = readRec();
    if (r) {
      r.backedUp = true;
      writeRec(r);
    }
    this.pendingPk = null;
    this.emit();
  }

  async unlock(password: string) {
    const r = readRec();
    if (!r) throw new Error('No trading wallet in this browser.');
    const pk = await unsealKey(r, password);
    this.setUnlocked(privateKeyToAccount(pk));
  }

  lock(why = '') {
    if (!this.acct && !this.pendingPk) return;
    this.acct = null;
    this.pendingPk = null;
    this.nonceNext = null;
    this.lockWhy = why;
    this.emit();
  }

  async exportKey(password: string) {
    const r = readRec();
    if (!r) throw new Error('No trading wallet in this browser.');
    return unsealKey(r, password);
  }

  forget() {
    localStorage.removeItem(REC_KEY);
    localStorage.setItem(USE_KEY, '0');
    this.acct = null;
    this.pendingPk = null;
    this.nonceNext = null;
    this.emit();
  }

  private setUnlocked(a: PrivateKeyAccount) {
    this.acct = a;
    this.nonceNext = null;
    this.lockWhy = '';
    this.lastAct = Date.now();
    this.emit();
  }

  validAddress(s: string): string | null {
    const v = String(s || '').trim();
    return isAddress(v, { strict: true }) ? getAddress(v) : null;
  }

  async qrSvg(text: string, px = 132): Promise<string> {
    return QRCode.toString(text, {
      type: 'svg',
      width: px,
      margin: 2,
      color: { dark: '#070224', light: '#ffffff' },
    });
  }

  async twBalance(): Promise<bigint> {
    const a = this.twAddress();
    return a ? BigInt(await rhRpc('eth_getBalance', [a, 'latest'])) : 0n;
  }

  private async fees() {
    const b = await rhRpc('eth_getBlockByNumber', ['latest', false]);
    const base = BigInt((b && b.baseFeePerGas) || '0x989680');
    return { base, maxFee: base * 2n };
  }

  private async nextNonce(a: string) {
    try {
      const n = BigInt(await rhRpc('eth_getTransactionCount', [a, 'pending']));
      return this.nonceNext != null && this.nonceNext > n ? this.nonceNext : n;
    } catch (e) {
      if (this.nonceNext != null) return this.nonceNext;
      throw e;
    }
  }

  private async postRaw(raw: string) {
    const r = await fetch(SC_CONST.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'eth_sendRawTransaction',
        params: [raw],
      }),
    });
    if (r.status === 429 || r.status >= 500) {
      throw Object.assign(new Error('RPC busy (HTTP ' + r.status + ')'), { retry: true });
    }
    const d = await r.json();
    if (d && d.error) {
      if (d.error.code === 429) throw Object.assign(new Error('RPC rate limit'), { retry: true });
      if (/already known|known transaction/i.test(d.error.message || '')) return null;
      throw Object.assign(new Error(d.error.message || 'The RPC rejected the transaction.'), {
        data: d.error.data,
      });
    }
    return d.result;
  }

  private async broadcastRaw(raw: string) {
    let wait = 600;
    let last: any;
    for (let i = 0; i < 6; i++) {
      try {
        return await this.postRaw(raw);
      } catch (e: any) {
        last = e;
        if (!e?.retry && !(e instanceof TypeError)) throw e;
      }
      await sleep(wait);
      wait = Math.min(wait * 2, 4000);
    }
    throw new Error(
      'Could not reach the Robinhood Chain RPC to send the transaction (' +
        (last && last.message) +
        '). Nothing was charged; try again.'
    );
  }

  private async waitReceipt(hash: string, label: string) {
    for (let i = 0; i < 240; i++) {
      let r: any = null;
      try {
        r = await rhRpc('eth_getTransactionReceipt', [hash]);
      } catch {
        // retry polling
      }
      if (r && r.blockNumber) {
        if (r.status === '0x0') throw Object.assign(new Error(label + ' failed on-chain.'), { hash });
        return r;
      }
      await sleep(i < 40 ? 400 : 2000);
    }
    throw Object.assign(
      new Error('Timed out waiting for confirmation. Check the transaction on the explorer.'),
      { hash }
    );
  }

  private async signSend(
    a: PrivateKeyAccount,
    t: { to: `0x${string}`; value: bigint; data: `0x${string}`; gas: bigint; maxFeePerGas: bigint },
    label: string
  ) {
    const nonce = await this.nextNonce(a.address);
    const raw = await a.signTransaction({
      chainId: SC_CONST.chainId,
      type: 'eip1559',
      nonce: Number(nonce),
      maxPriorityFeePerGas: 0n,
      ...t,
    });
    const hash = keccak256(raw);
    await this.broadcastRaw(raw);
    this.nonceNext = nonce + 1n;
    return this.waitReceipt(hash, label);
  }

  private async doSend(tx: { to: string; value?: bigint; data?: string }, label: string) {
    const a = this.acct;
    if (!a) throw new Error('Unlock your trading wallet first.');
    this.lastAct = Date.now();
    const value = BigInt(tx.value || 0n);
    const data = (tx.data || '0x') as `0x${string}`;
    const base = { from: a.address, to: tx.to, data, value: hex(value) };
    const [{ maxFee }, bal] = await Promise.all([
      this.fees(),
      rhRpc('eth_getBalance', [a.address, 'latest']).then(BigInt),
    ]);
    if (bal < value) {
      throw new Error(
        `Not enough ETH in your trading wallet: this needs ${fmtEth(value)} ETH plus a small network fee, it holds ${fmtEth(bal)} ETH.`
      );
    }
    await rhCall(tx.to, data, { from: a.address, value: base.value });
    const gas = (BigInt(await rhRpc('eth_estimateGas', [base])) * 13n) / 10n;
    if (bal < value + gas * maxFee) {
      throw new Error(
        `Not enough ETH in your trading wallet: this needs about ${fmtEth(value + gas * maxFee)} ETH including the network fee, it holds ${fmtEth(bal)} ETH.`
      );
    }
    if (this.acct !== a) {
      throw new Error('The trading wallet was locked before the transaction was signed. Nothing was sent.');
    }
    return this.signSend(a, { to: tx.to as `0x${string}`, value, data, gas, maxFeePerGas: maxFee }, label);
  }

  private async doWithdraw(toRaw: string) {
    const a = this.acct;
    if (!a) throw new Error('Unlock your trading wallet first.');
    const to = this.validAddress(toRaw);
    if (!to) {
      throw new Error('Enter a valid destination address (0x followed by 40 hex characters; mixed case must match the checksum).');
    }
    if (to.toLowerCase() === a.address.toLowerCase()) {
      throw new Error('That is the trading wallet itself. Enter another address.');
    }
    const [{ base }, bal] = await Promise.all([
      this.fees(),
      rhRpc('eth_getBalance', [a.address, 'latest']).then(BigInt),
    ]);
    const gas = (BigInt(await rhRpc('eth_estimateGas', [{ from: a.address, to, value: '0x1' }])) * 12n) / 10n;
    const maxFee = (base * 3n) / 2n;
    const amount = bal - gas * maxFee;
    if (amount <= 0n) throw new Error(`The balance (${fmtEth(bal)} ETH) does not cover the network fee.`);
    const rc = await this.signSend(
      a,
      { to: to as `0x${string}`, value: amount, data: '0x', gas, maxFeePerGas: maxFee },
      `Withdraw ${fmtEth(amount)} ETH`
    );
    return { receipt: rc, amount, to };
  }

  twSend(tx: { to: string; value?: bigint; data?: string }, label: string) {
    const p = this.txQueue.then(() => this.doSend(tx, label));
    this.txQueue = p.catch(() => {});
    return p;
  }

  withdrawAll(to: string) {
    const p = this.txQueue.then(() => this.doWithdraw(to));
    this.txQueue = p.catch(() => {});
    return p;
  }

  // ---------- External EIP-1193 / EIP-6963 Wallet ----------
  requestWallets() {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('eip6963:requestProvider'));
  }

  walletOptions(): WalletOption[] {
    const l = this.extList.slice();
    const w = typeof window !== 'undefined' ? (window as any) : null;
    if (!l.length && w?.ethereum) {
      l.push({
        info: {
          uuid: 'injected',
          name: w.ethereum.isMetaMask
            ? 'MetaMask'
            : w.ethereum.isCoinbaseWallet
              ? 'Coinbase Wallet'
              : 'Browser wallet',
          icon: '',
          rdns: 'injected',
        },
        provider: w.ethereum,
      });
    }
    return l;
  }

  private hookProvider(p: any) {
    if (this.hookedProviders.has(p) || !p.on) return;
    this.hookedProviders.add(p);
    p.on('accountsChanged', (a: string[]) => {
      if (this.extProvider !== p) return;
      this.extAccount = (a && a[0]) || null;
      if (!this.extAccount) localStorage.removeItem(EXT_KEY);
      this.emit();
    });
    p.on('chainChanged', (c: string) => {
      if (this.extProvider !== p) return;
      this.extChainId = parseInt(c, 16);
      this.emit();
    });
  }

  async connectExternal(opt: WalletOption, prompt = true): Promise<boolean> {
    const p = opt.provider;
    const acc = await p.request({ method: prompt ? 'eth_requestAccounts' : 'eth_accounts' });
    if (!acc || !acc[0]) return false;
    this.extProvider = p;
    this.extInfo = opt.info;
    this.extAccount = acc[0];
    this.extChainId = parseInt(await p.request({ method: 'eth_chainId' }), 16);
    this.hookProvider(p);
    localStorage.setItem(EXT_KEY, opt.info.rdns || opt.info.name);
    this.emit();
    return true;
  }

  disconnectExternal() {
    this.extAccount = null;
    this.extProvider = null;
    this.extInfo = null;
    localStorage.removeItem(EXT_KEY);
    if (this.mode === 'ext') this.setMode('tw');
    this.emit();
  }

  async autoReconnect() {
    const want = localStorage.getItem(EXT_KEY);
    if (!want || this.extAccount) return;
    await sleep(250);
    const o = this.walletOptions().find((x) => (x.info.rdns || x.info.name) === want);
    if (o) {
      try {
        await this.connectExternal(o, false);
      } catch {
        // silent reconnect ignore
      }
    }
  }

  async ensureChain(targetId: number = SC_CONST.chainId, customParams?: any) {
    if (!this.extProvider) throw new Error('Connect a browser wallet first.');
    if (this.extChainId === targetId) return;
    const cid = hex(targetId);
    try {
      await this.extProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cid }] });
    } catch (e: any) {
      const code = e && (e.code ?? e.data?.originalError?.code);
      if (code !== 4902 && !/unrecognized|not added|unknown chain/i.test(String(e?.message || ''))) {
        throw e;
      }
      const params = targetId === SC_CONST.chainId ? RH_CHAIN_PARAMS : customParams;
      if (!params) throw e;
      await this.extProvider.request({ method: 'wallet_addEthereumChain', params: [params] });
      await this.extProvider
        .request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cid }] })
        .catch(() => {});
    }
    this.extChainId = parseInt(await this.extProvider.request({ method: 'eth_chainId' }), 16);
    if (this.extChainId !== targetId) {
      throw new Error(`Please switch your wallet to ${targetId === SC_CONST.chainId ? 'Robinhood Chain' : 'Chain ' + targetId}.`);
    }
  }

  async extSend(tx: { to: string; value?: bigint; data?: string }, statusCb: (s: string) => void): Promise<string> {
    await this.ensureChain(SC_CONST.chainId);
    statusCb('Confirm in your wallet');
    const base = { from: this.extAccount, to: tx.to, data: tx.data || '0x', value: hex(tx.value || 0n) };
    const [est, gp] = await Promise.all([
      rhRpc('eth_estimateGas', [base]),
      rhRpc('eth_gasPrice', []),
    ]);
    const hash: string = await this.extProvider.request({
      method: 'eth_sendTransaction',
      params: [
        {
          ...base,
          gas: hex((BigInt(est) * 13n) / 10n),
          gasPrice: hex((BigInt(gp) * 12n) / 10n),
          chainId: hex(SC_CONST.chainId),
        },
      ],
    });
    statusCb('Waiting for confirmation');
    for (let i = 0; i < 150; i++) {
      let r: any = null;
      try {
        r = await rhRpc('eth_getTransactionReceipt', [hash]);
      } catch {
        // retry
      }
      if (r && r.blockNumber) {
        if (r.status === '0x0') throw new Error('Transaction failed on-chain.');
        return hash;
      }
      await sleep(i < 20 ? 500 : 2000);
    }
    throw new Error('Timed out waiting for confirmation. Check your wallet activity.');
  }

  activeAccount = () => (this.mode === 'tw' ? this.twAddress() : this.extAccount) || null;
  isTradeReady = () => (this.mode === 'tw' ? this.twUnlocked() : !!this.extAccount);

  async sendTradeTx(tx: { to: string; value?: bigint; data?: string }, statusCb: (s: string) => void, label: string) {
    if (this.mode === 'tw') {
      statusCb('Signing in this browser');
      const rc = await this.twSend(tx, label || 'Trade');
      return rc.transactionHash as string;
    }
    return this.extSend(tx, statusCb);
  }
}

export const walletManager = new WalletController();
