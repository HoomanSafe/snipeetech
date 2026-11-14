import { useEffect, useState } from 'react';
import { artUrl, hueFromAddr } from '../lib/format';

interface TokenLogoProps {
  address: string;
  symbol?: string;
  name?: string;
  artwork?: string | null;
  size?: number;
}

const BAD_ART = new Set<string>();
const GOOD_GW = new Map<string, number>();

export function TokenLogo({ address, symbol, name, artwork, size = 28 }: TokenLogoProps) {
  const [gw, setGw] = useState<number>(() => (artwork ? GOOD_GW.get(artwork) || 0 : 0));
  const [failed, setFailed] = useState<boolean>(() => (artwork ? BAD_ART.has(artwork) : true));

  useEffect(() => {
    if (!artwork) {
      setFailed(true);
      return;
    }
    setFailed(BAD_ART.has(artwork));
    setGw(GOOD_GW.get(artwork) || 0);
  }, [artwork]);

  const src = !failed && artwork ? artUrl(artwork, gw) : '';
  const letter = (symbol || name || '?').replace(/^\$/, '').charAt(0).toUpperCase();
  const hue = hueFromAddr(address);

  return (
    <span className="tlogo" style={{ width: size, height: size }}>
      <span className="ph" style={{ ['--h' as any]: hue, fontSize: Math.max(10, Math.round(size * 0.42)) }}>
        {letter}
      </span>
      {src ? (
        <img
          src={src}
          alt={symbol || name || ''}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            if (!artwork) {
              setFailed(true);
              return;
            }
            const nextGw = gw + 1;
            const nextUrl = artUrl(artwork, nextGw);
            if (nextUrl) {
              GOOD_GW.set(artwork, nextGw);
              setGw(nextGw);
            } else {
              BAD_ART.add(artwork);
              setFailed(true);
            }
          }}
        />
      ) : null}
    </span>
  );
}
