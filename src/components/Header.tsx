import { useEffect, useRef, useState } from 'react';
import { SITE_CONFIG, STAKING_LIVE, isValidAddr } from '../config/siteConfig';
import { searchRemoteTokens, type TokenItem } from '../lib/api';
import { formatCompact, shortAddr } from '../lib/format';
import { TokenLogo } from './TokenLogo';

interface HeaderProps {
  navKey: string;
  tokens: TokenItem[];
  searchQuery: string;
  onNavigate: (hash: string) => void;
  onCopy: (text: string, label?: string) => void;
}

export function Header({ navKey, tokens, searchQuery, onNavigate, onCopy }: HeaderProps) {
  const [q, setQ] = useState(searchQuery);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<TokenItem[]>([]);
  const [copiedCa, setCopiedCa] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQ(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (e.key === '/' && document.activeElement !== inputRef.current && tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    const trimmed = q.trim();
    if (!trimmed) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      const s = trimmed.toLowerCase();
      let items = tokens
        .filter(
          (L) =>
            L.address.toLowerCase() === s ||
            L.symbol.toLowerCase().includes(s) ||
            L.name.toLowerCase().includes(s) ||
            (s.length >= 6 && L.address.toLowerCase().includes(s))
        )
        .sort(
          (a, b) =>
            Number(b.symbol.toLowerCase() === s) - Number(a.symbol.toLowerCase() === s) ||
            (b.marketCapUsd || 0) - (a.marketCapUsd || 0)
        )
        .slice(0, 8);

      if (items.length < 8) {
        try {
          const more = await searchRemoteTokens(trimmed);
          if (!alive) return;
          const have = new Set(items.map((x) => x.address));
          items = items.concat(more.filter((x) => !have.has(x.address))).slice(0, 8);
        } catch {
          // ignore remote search failure
        }
      }
      if (!alive) return;
      setSuggestions(items);
      setOpen(true);
    }, 150);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, tokens]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key !== 'Enter') return;
    const v = q.trim();
    setOpen(false);
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) {
      onNavigate(`#/token/${v.toLowerCase()}`);
    } else {
      onNavigate(v ? `#/?q=${encodeURIComponent(v)}` : '#/');
    }
  };

  const caValid = isValidAddr(SITE_CONFIG.CA);
  const tickerClean = SITE_CONFIG.TICKER.replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  const tickerLabel = tickerClean ? `$${tickerClean}` : 'CA';

  return (
    <header className="top">
      <a className="brand" href="#/" aria-label={`${SITE_CONFIG.PROJECT_NAME} home`}>
        <img src={SITE_CONFIG.LOGO_SRC} alt="" width={34} height={34} />
        <span>
          <b>SNIPE</b>
          <i>TECH</i>
        </span>
      </a>

      <nav className="mainnav" aria-label="Main">
        <a href="#/sniper" className={navKey === 'sniper' ? 'on' : ''} aria-current={navKey === 'sniper' ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          <span>Sniper</span>
        </a>

        <a href="#/" className={navKey === 'screener' ? 'on' : ''} aria-current={navKey === 'screener' ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19h16M7 15l4-5 3 3 5-7" />
          </svg>
          <span>Screener</span>
        </a>

        <a href="#/bridge" className={navKey === 'bridge' ? 'on' : ''} aria-current={navKey === 'bridge' ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 17h18M5 17v-4a7 7 0 0 1 14 0v4M9 17v-3M15 17v-3" />
          </svg>
          <span>Bridge</span>
        </a>

        <a href="#/staking" className={navKey === 'staking' ? 'on' : ''} aria-current={navKey === 'staking' ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="6" rx="7" ry="3" />
            <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
          </svg>
          <span>Staking</span>
          {!STAKING_LIVE ? <i className="soon">Soon</i> : null}
        </a>
      </nav>

      <div className="search" ref={wrapRef}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          id="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (q.trim() && suggestions.length) setOpen(true);
          }}
          placeholder="Search name, symbol or 0x address"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search tokens"
        />
        {open && q.trim() ? (
          <div className="suggest">
            {suggestions.length ? (
              <>
                {suggestions.map((L) => (
                  <a
                    key={L.address}
                    href={`#/token/${L.address}`}
                    onClick={() => setOpen(false)}
                  >
                    <TokenLogo address={L.address} symbol={L.symbol} name={L.name} artwork={L.artwork} size={24} />
                    <span>
                      <b>{L.symbol}</b> <span className="muted">{L.name}</span>
                    </span>
                    {L.quote ? (
                      <span className={`ver ${/^W?ETH$/.test(L.quote) ? 'v1' : 'v2'}`}>{L.quote}</span>
                    ) : null}
                    <span className="mono">{formatCompact(L.marketCapUsd)}</span>
                  </a>
                ))}
                <a
                  className="all"
                  href={`#/?q=${encodeURIComponent(q.trim())}`}
                  onClick={() => setOpen(false)}
                >
                  See all results for “{q.trim()}” →
                </a>
              </>
            ) : (
              <div className="none">No Pons token matches “{q.trim()}”.</div>
            )}
          </div>
        ) : null}
      </div>

      {caValid ? (
        <div className="tokcta">
          <span className="ca-pill" title={`${tickerLabel} contract address: ${SITE_CONFIG.CA}`}>
            <a href={`#/token/${SITE_CONFIG.CA}`}>
              <span className="ca-l">{tickerLabel}</span>
              <span className="mono">{shortAddr(SITE_CONFIG.CA)}</span>
            </a>
            <button
              type="button"
              className="ca-cp"
              aria-label="Copy contract address"
              onClick={() => {
                onCopy(SITE_CONFIG.CA);
                setCopiedCa(true);
                setTimeout(() => setCopiedCa(false), 1500);
              }}
            >
              <span>{copiedCa ? 'Copied' : 'Copy CA'}</span>
            </button>
          </span>
          <a
            className="buy-btn"
            href={`${SITE_CONFIG.BUY_URL}${SITE_CONFIG.CA}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Buy {tickerLabel}
          </a>
        </div>
      ) : null}

      <div className="top-right">
        <span className="chain-pill" title="Robinhood Chain (chain ID 4663)">
          <i className="dot" />
          Robinhood Chain
        </span>
        <a
          className="x-link"
          href={SITE_CONFIG.X_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`SNIPETECH on X (@${SITE_CONFIG.X_HANDLE})`}
          title={`@${SITE_CONFIG.X_HANDLE} on X`}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
      </div>
    </header>
  );
}
