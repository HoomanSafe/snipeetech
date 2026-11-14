/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Ticker } from './components/Ticker';
import { WalletModal } from './components/WalletModal';
import { SITE_CONFIG, isValidAddr } from './config/siteConfig';
import { fetchAllTokens, type TokenItem } from './lib/api';
import { walletManager } from './lib/walletManager';
import { BridgePage } from './pages/BridgePage';
import { ScreenerPage } from './pages/ScreenerPage';
import { SniperPage } from './pages/SniperPage';
import { StakingPage } from './pages/StakingPage';
import { TokenDetailPage } from './pages/TokenDetailPage';

type ParsedRoute =
  | { page: 'screener'; tab: string; pair: string; q: string }
  | { page: 'token'; address: string }
  | { page: 'sniper'; ca: string }
  | { page: 'bridge' }
  | { page: 'staking' };

const VALID_TABS = new Set(['top', 'trending', 'new', 'gainers', 'graduating', 'graduated']);
const VALID_PAIRS = new Set(['all', 'eth', 'usdg', 'stocks']);

function parseHash(rawHash: string): ParsedRoute {
  const hash = (rawHash || '#/').replace(/^#/, '');
  const [rawPath, rawSearch = ''] = hash.split('?');
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const qs = new URLSearchParams(rawSearch);

  if (path === '/earn' || path.startsWith('/earn/')) {
    return { page: 'screener', tab: 'top', pair: 'all', q: '' };
  }

  const tokMatch = /^\/token\/(0x[0-9a-fA-F]{40})\/?$/i.exec(path);
  if (tokMatch) {
    return { page: 'token', address: tokMatch[1].toLowerCase() };
  }

  if (path === '/sniper' || path.startsWith('/sniper/')) {
    const caParam = (qs.get('ca') || '').trim();
    return { page: 'sniper', ca: isValidAddr(caParam) ? caParam : '' };
  }

  if (path === '/bridge' || path.startsWith('/bridge/')) {
    return { page: 'bridge' };
  }

  if (path === '/staking' || path.startsWith('/staking/')) {
    return { page: 'staking' };
  }

  const tabRaw = (qs.get('tab') || 'top').toLowerCase();
  const pairRaw = (qs.get('pair') || 'all').toLowerCase();
  return {
    page: 'screener',
    tab: VALID_TABS.has(tabRaw) ? tabRaw : 'top',
    pair: VALID_PAIRS.has(pairRaw) ? pairRaw : 'all',
    q: qs.get('q') || '',
  };
}

export default function App() {
  const [route, setRoute] = useState<ParsedRoute>(() => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#/earn')) {
      window.location.replace('#/');
    }
    return parseHash(typeof window !== 'undefined' ? window.location.hash : '#/');
  });

  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [walletOpen, setWalletOpen] = useState(false);
  const [walletTab, setWalletTab] = useState<'tw' | 'ext' | undefined>(undefined);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1800);
  }, []);

  const handleCopy = useCallback(
    (text: string, label = 'Copied') => {
      if (!text) return;
      navigator.clipboard
        ?.writeText(text)
        .then(() => showToast(label))
        .catch(() => showToast('Copy failed'));
    },
    [showToast]
  );

  const navigate = useCallback((hash: string) => {
    const nextHash = hash.startsWith('#') ? hash : `#${hash}`;
    if (window.location.hash === nextHash) {
      setRoute(parseHash(nextHash));
    } else {
      window.location.hash = nextHash;
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const loadTokens = useCallback(async (ttl = 10000) => {
    try {
      const { list } = await fetchAllTokens(ttl);
      setTokens(list);
      setErr('');
    } catch (e: any) {
      setErr(e?.message || 'Could not load Pons launches right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTokens(10000);
    walletManager.autoReconnect();
  }, [loadTokens]);

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith('#/earn')) {
        window.location.replace('#/');
        return;
      }
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (route.page === 'screener') {
      document.title = `${SITE_CONFIG.PROJECT_NAME} — Pons tokens on Robinhood Chain`;
    }
  }, [route.page]);

  const topTickerItems = useMemo(
    () =>
      tokens
        .filter((t) => (t.marketCapUsd || 0) > 0)
        .slice()
        .sort((a, b) => (b.marketCapUsd || 0) - (a.marketCapUsd || 0))
        .slice(0, 10),
    [tokens]
  );

  const stakingTokenPriceUsd = useMemo(() => {
    if (!isValidAddr(SITE_CONFIG.CA)) return null;
    const target = SITE_CONFIG.CA.toLowerCase();
    const found = tokens.find((t) => t.address.toLowerCase() === target);
    return found?.priceUsd ?? null;
  }, [tokens]);

  const openWallet = useCallback((preferredTab?: 'tw' | 'ext') => {
    setWalletTab(preferredTab);
    setWalletOpen(true);
  }, []);

  const navKey = route.page === 'token' ? 'screener' : route.page;

  return (
    <>
      <Header
        navKey={navKey}
        tokens={tokens}
        searchQuery={route.page === 'screener' ? route.q : ''}
        onNavigate={navigate}
        onCopy={handleCopy}
      />

      <Ticker items={topTickerItems} />

      <main className="app">
        {route.page === 'screener' ? (
          <ScreenerPage
            tokens={tokens}
            loading={loading}
            err={err}
            tab={route.tab}
            pair={route.pair}
            q={route.q}
            onRefresh={() => loadTokens(0)}
            onNavigate={navigate}
          />
        ) : route.page === 'token' ? (
          <TokenDetailPage
            key={route.address}
            address={route.address}
            tokens={tokens}
            onCopy={(text) => handleCopy(text)}
            onOpenWallet={() => openWallet()}
          />
        ) : route.page === 'sniper' ? (
          <SniperPage
            initialCa={route.ca}
            tokens={tokens}
            onOpenWallet={() => openWallet()}
          />
        ) : route.page === 'bridge' ? (
          <BridgePage onOpenWallet={() => openWallet('ext')} />
        ) : (
          <StakingPage
            tokenPriceUsd={stakingTokenPriceUsd}
            onOpenWallet={() => openWallet('ext')}
            onCopy={(text) => handleCopy(text)}
          />
        )}
      </main>

      <Footer onCopy={(text) => handleCopy(text)} />

      <WalletModal
        open={walletOpen}
        initialTab={walletTab}
        onClose={() => setWalletOpen(false)}
        onCopy={(text) => handleCopy(text)}
      />

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </>
  );
}
