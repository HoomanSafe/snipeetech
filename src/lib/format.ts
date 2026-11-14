import { SITE_CONFIG } from '../config/siteConfig';

export const EXPLORER = SITE_CONFIG.EXPLORER;
export const PONS_URL = SITE_CONFIG.PONS_URL;
export const tradeUrl = (a: string) => `${PONS_URL}/launchpad/${a}`;

export const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

export function formatPrice(v: number | null | undefined, sym = '$'): string {
  if (!isNum(v) || v <= 0) return '—';
  if (v >= 1000) return sym + v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return sym + v.toFixed(4).replace(/\.?0+$/, '');
  if (v >= 0.0001) return sym + v.toFixed(6).replace(/0+$/, '');
  const s = v.toExponential(3);
  const m = s.match(/^(\d\.\d+)e-(\d+)$/);
  if (!m) return sym + s;
  const z = Number(m[2]) - 1;
  const sub = String(z)
    .split('')
    .map((d) => String.fromCharCode(0x2080 + Number(d)))
    .join('');
  return `${sym}0.0${sub}${m[1].replace('.', '').slice(0, 4)}`;
}

export function formatCompact(v: number | null | undefined, sym = '$'): string {
  if (!isNum(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return sign + sym + (abs / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return sign + sym + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return sign + sym + (abs / 1e3).toFixed(1) + 'K';
  if (abs >= 1) return sign + sym + abs.toFixed(2);
  if (abs > 0) return sign + sym + abs.toPrecision(3);
  return sym + '0';
}

export function formatNum(v: number | null | undefined, dec = 0): string {
  if (!isNum(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: dec });
}

export function formatPct(v: number | null | undefined): { text: string; cls: 'up' | 'down' | 'flat' } {
  if (!isNum(v)) return { text: '—', cls: 'flat' };
  const p = v * 100;
  const cls = p > 0.05 ? 'up' : p < -0.05 ? 'down' : 'flat';
  const sign = p > 0 ? '+' : '';
  return { text: `${sign}${p.toFixed(2)}%`, cls };
}

export function formatAge(sec: number | null | undefined): string {
  if (!isNum(sec) || sec <= 0) return '—';
  const d = Math.max(0, Math.floor(Date.now() / 1000 - sec));
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export function shortAddr(a: string | null | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
}

export function formatDateTime(sec: number | null | undefined): string {
  if (!isNum(sec) || sec <= 0) return '—';
  return new Date(sec * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function safeHref(u: string | null | undefined): string {
  if (!u) return '';
  try {
    const x = new URL(u);
    return /^https?:$/.test(x.protocol) ? x.toString() : '';
  } catch {
    return '';
  }
}

export function hueFromAddr(str: string): number {
  let h = 0;
  for (const c of String(str || '')) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

const PONS_ART = 'https://dbk-vercel.vercel.app/api/ipfs/content/';
const CID_RE = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

function cidOf(src: string | null | undefined, deep = true): string {
  const t = String(src || '')
    .trim()
    .replace(/^ipfs:\/\/(?=https?:\/\/)/i, '');
  const m = /^ipfs:\/\/(?:ipfs\/)?([a-zA-Z0-9]+)(\/.*)?$/.exec(t);
  if (m) return m[1] + (m[2] || '');
  if (CID_RE.test(t)) return t;
  try {
    const u = new URL(t);
    if (!/^https?:$/.test(u.protocol)) return '';
    const parts = u.pathname.split('/').filter(Boolean);
    const i = parts.findIndex((x) => x.toLowerCase() === 'ipfs');
    if (i >= 0 && parts[i + 1] && /^[a-zA-Z0-9]+$/.test(parts[i + 1])) {
      return parts.slice(i + 1).join('/');
    }
    const h = u.hostname.split('.');
    if ((h[1] || '').toLowerCase() === 'ipfs' && /^[a-zA-Z0-9]+$/.test(h[0])) {
      return h[0] + (u.pathname !== '/' ? u.pathname : '');
    }
    const q = deep ? (u.searchParams.get('url') || '').trim() : '';
    if (q) return cidOf(/^https?:\/\//i.test(q) ? q : 'https://' + q, false);
  } catch {
    // ignore invalid url
  }
  return '';
}

export function artUrl(src: string | null | undefined, attempt = 0): string {
  if (!src) return '';
  const cid = cidOf(src);
  if (cid) {
    if (attempt === 0) return PONS_ART + cid + (cid.includes('/') ? '' : '?variant=compact');
    if (attempt === 1) return '/api/img?src=' + encodeURIComponent('ipfs://' + cid);
    return '';
  }
  if (/^https?:\/\//.test(src)) {
    return attempt === 0 ? '/api/img?src=' + encodeURIComponent(src) : '';
  }
  return '';
}
