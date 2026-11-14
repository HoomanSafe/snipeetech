import { useState } from 'react';
import { SITE_CONFIG, isValidAddr } from '../config/siteConfig';

export function Footer({ onCopy }: { onCopy: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const caValid = isValidAddr(SITE_CONFIG.CA);
  const tickerClean = SITE_CONFIG.TICKER.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  const lab = tickerClean ? `$${tickerClean}` : 'CA';

  return (
    <footer className="foot pfoot">
      <div className="pf-in">
        <span className="pf-brand">
          <img src={SITE_CONFIG.LOGO_SRC} alt="" width={22} height={22} />
          <b>SNIPE</b>
          <i>TECH</i>
          <span className="muted sm" style={{ marginLeft: 6 }}>
            · ${SITE_CONFIG.TICKER}
          </span>
        </span>

        {caValid ? (
          <div className="pf-ca">
            <span className="muted">{lab}</span>
            <a className="ca-full" href={`#/token/${SITE_CONFIG.CA}`}>
              {SITE_CONFIG.CA}
            </a>
            <button
              type="button"
              className="ca-cp"
              onClick={() => {
                onCopy(SITE_CONFIG.CA);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy CA'}
            </button>
            <a
              className="buy-btn sm"
              href={`${SITE_CONFIG.BUY_URL}${SITE_CONFIG.CA}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Buy
            </a>
          </div>
        ) : null}

        <a
          className="x-foot"
          href={SITE_CONFIG.X_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`SNIPETECH on X (@${SITE_CONFIG.X_HANDLE})`}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span>@{SITE_CONFIG.X_HANDLE}</span>
        </a>
      </div>
    </footer>
  );
}
