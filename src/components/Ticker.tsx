import { type TokenItem } from '../lib/api';
import { formatCompact, formatPct, formatPrice } from '../lib/format';
import { TokenLogo } from './TokenLogo';

export function Ticker({ items }: { items: TokenItem[] }) {
  if (!items.length) return null;
  const renderItems = (prefix: string) =>
    items.map((L, i) => {
      const p = formatPct(L.ch24);
      return (
        <a key={`${prefix}-${L.address}`} href={`#/token/${L.address}`}>
          <span className="tr">#{i + 1}</span>
          <TokenLogo address={L.address} symbol={L.symbol} name={L.name} artwork={L.artwork} size={18} />
          <b>{L.symbol}</b>
          <span className="mono">{formatPrice(L.priceUsd)}</span>
          <span className={`mono ${p.cls}`}>{p.text}</span>
          <span className="muted">{formatCompact(L.marketCapUsd)}</span>
        </a>
      );
    });

  return (
    <div className="ticker">
      <span className="tl">Top market cap</span>
      <div className="tt">
        <div className="tin">
          {renderItems('a')}
          {renderItems('b')}
        </div>
      </div>
    </div>
  );
}
