import { useEffect, useState } from 'react';
import { SITE_CONFIG, STAKING_LIVE } from '../config/siteConfig';
import { formatCompact } from '../lib/format';
import { fmtUnits, toUnits, tradeErrMsg } from '../lib/sniperTrade';
import { rhCall, rhRpc, walletManager } from '../lib/walletManager';

const PRECISION = 10n ** 36n;
const SEL = {
  totalStaked: '0x817b1cd2',
  accRewardPerWeight: '0xaa6bb09a',
  totalRewardsDistributed: '0xee172546',
  queuedRewards: '0x63d38c3b',
  stakingPaused: '0xbbb781cc',
  tiers: '0x4a95d9d5',
  positionsOf: '0xf867d46b',
  unclaimedRewards: '0x949813b8',
  stake: '0x10087fb1',
  withdraw: '0x2e1a7d4d',
  claimAll: '0xd1058e59',
  approve: '0x095ea7b3',
  allowance: '0xdd62ed3e',
  balanceOf: '0x70a08231',
  totalSupply: '0x18160ddd',
  decimals: '0x313ce567',
};

const word = (v: bigint | number) => BigInt(v).toString(16).padStart(64, '0');
const addrWord = (a: string) => a.slice(2).toLowerCase().padStart(64, '0');
const words = (h: string) => {
  const clean = (h || '0x').slice(2);
  const out: bigint[] = [];
  for (let i = 0; i < clean.length; i += 64) {
    out.push(BigInt('0x' + clean.slice(i, i + 64)));
  }
  return out;
};
const mult = (bps: bigint | number) => {
  const x = Number(bps) / 10000;
  return (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(2))) + 'x';
};
const days = (sec: bigint | number) => Math.round(Number(sec) / 86400);

export function StakingPage({
  tokenPriceUsd,
  onOpenWallet,
  onCopy,
}: {
  tokenPriceUsd: number | null;
  onOpenWallet: () => void;
  onCopy: (text: string) => void;
}) {
  const [g, setG] = useState<any>(null);
  const [u, setU] = useState<any>(null);
  const [decimals, setDecimals] = useState(18);
  const [tier, setTier] = useState(0);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    document.title = STAKING_LIVE
      ? `Staking — ${SITE_CONFIG.PROJECT_NAME}`
      : `Staking (coming soon) — ${SITE_CONFIG.PROJECT_NAME}`;
    return walletManager.subscribe(() => setTick((t) => t + 1));
  }, []);

  const refresh = async () => {
    if (!STAKING_LIVE) return;
    const C = SITE_CONFIG.STAKING;
    const T = SITE_CONFIG.CA;
    try {
      const [ts, acc, dist, queued, paused, tiers, supply, dec] = await Promise.all([
        rhCall(C, SEL.totalStaked),
        rhCall(C, SEL.accRewardPerWeight),
        rhCall(C, SEL.totalRewardsDistributed),
        rhCall(C, SEL.queuedRewards),
        rhCall(C, SEL.stakingPaused),
        rhCall(C, SEL.tiers),
        rhCall(T, SEL.totalSupply),
        rhCall(T, SEL.decimals),
      ]);
      const d = Number(words(dec)[0] || 18);
      setDecimals(d);
      const tw = words(tiers);
      setG({
        totalStaked: words(ts)[0],
        acc: words(acc)[0],
        distributed: words(dist)[0],
        queued: words(queued)[0],
        paused: words(paused)[0] === 1n,
        tiers: [0, 1, 2].map((i) => ({ duration: tw[i * 2], bps: tw[i * 2 + 1] })),
        supply: words(supply)[0],
      });

      const acct = walletManager.extAccount;
      if (acct) {
        const [pos, unc, bal, alw, eth] = await Promise.all([
          rhCall(C, SEL.positionsOf + addrWord(acct)),
          rhCall(C, SEL.unclaimedRewards + addrWord(acct)),
          rhCall(T, SEL.balanceOf + addrWord(acct)),
          rhCall(T, SEL.allowance + addrWord(acct) + addrWord(C)),
          rhRpc('eth_getBalance', [acct, 'latest']),
        ]);
        const w = words(pos);
        const n = Number(w[1] || 0n);
        const list = [];
        for (let i = 0; i < n; i++) {
          const o = 2 + i * 7;
          list.push({
            id: i,
            amount: w[o],
            start: w[o + 1],
            unlockAt: w[o + 2],
            tier: Number(w[o + 3]),
            withdrawn: w[o + 4] === 1n,
            weight: w[o + 5],
            debt: w[o + 6],
          });
        }
        setU({
          positions: list,
          unclaimed: words(unc)[0],
          bal: words(bal)[0],
          allowance: words(alw)[0],
          eth: BigInt(eth),
        });
      } else {
        setU(null);
      }
    } catch (e) {
      setErr(tradeErrMsg(e));
    }
  };

  useEffect(() => {
    if (!STAKING_LIVE) return;
    refresh();
    const id = setInterval(() => {
      if (!busy && !document.hidden) refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [walletManager.extAccount, busy]);

  if (!STAKING_LIVE) {
    return (
      <section className="soonpage">
        <div className="soonbox">
          <span className="soonicon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="6" rx="7" ry="3" />
              <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
            </svg>
          </span>
          <h1>Staking</h1>
          <p className="muted">Stake ${SITE_CONFIG.TICKER} tokens and earn ETH rewards.</p>
          <span className="soonlabel">Coming soon</span>
        </div>
        <a className="btn pri" href="#/">
          ← Back to screener
        </a>
      </section>
    );
  }

  if (!g) {
    return <div className="loading">Loading staking contract…</div>;
  }

  const sendStakingTx = async (to: string, data: string, okText: string) => {
    setBusy(true);
    setErr('');
    setOk('');
    setLastTx(null);
    try {
      const h = await walletManager.extSend({ to, data }, () => {});
      setLastTx(h);
      setOk(okText);
      await refresh();
    } catch (e) {
      setErr(tradeErrMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const amt = toUnits(amount, decimals);
  const t = g.tiers[tier];
  const active = u ? u.positions.filter((p: any) => !p.withdrawn) : [];
  const myStaked = active.reduce((s: bigint, p: any) => s + p.amount, 0n);
  const pendingOf = (p: any): bigint => {
    if (p.withdrawn) return 0n;
    const a = (BigInt(p.weight) * BigInt(g.acc)) / PRECISION;
    const debt = BigInt(p.debt);
    return a > debt ? a - debt : 0n;
  };
  const claimable: bigint = u
    ? BigInt(u.unclaimed) + u.positions.reduce((s: bigint, p: any) => s + pendingOf(p), 0n)
    : 0n;

  const tvlUsd =
    tokenPriceUsd != null ? (Number(g.totalStaked) / 10 ** decimals) * tokenPriceUsd : null;

  const needApprove = u && amt > 0n && u.allowance < amt;

  return (
    <section className="staking">
      <div className="sk-head">
        <div>
          <span className="sk-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="6" rx="7" ry="3" />
              <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
            </svg>
          </span>
          <h1>Staking</h1>
          <p className="muted">Stake ${SITE_CONFIG.TICKER} and earn ETH rewards.</p>
        </div>
        <button type="button" className="wbtn" onClick={onOpenWallet}>
          {walletManager.extAccount
            ? `${walletManager.extAccount.slice(0, 6)}…${walletManager.extAccount.slice(-4)}`
            : 'Connect wallet'}
        </button>
      </div>

      <div className="sk-stats">
        <div className="kv">
          <span>Total staked</span>
          <b>{fmtUnits(g.totalStaked, decimals, 0)}</b>
          <em>
            {SITE_CONFIG.TICKER}
            {tvlUsd != null ? ` · ${formatCompact(tvlUsd)}` : ''}
          </em>
        </div>
        <div className="kv">
          <span>ETH rewards distributed</span>
          <b>{fmtUnits(g.distributed, 18, 4)}</b>
          <em>ETH all time</em>
        </div>
        <div className="kv">
          <span>Your stake</span>
          <b>{walletManager.extAccount && u ? fmtUnits(myStaked, decimals, 0) : '—'}</b>
          <em>
            {walletManager.extAccount && u
              ? `${active.length} active position${active.length === 1 ? '' : 's'}`
              : 'Connect a wallet'}
          </em>
        </div>
        <div className="kv">
          <span>Your claimable ETH</span>
          <b>{walletManager.extAccount && u ? fmtUnits(claimable, 18, 6) : '—'}</b>
          {walletManager.extAccount && u && claimable > 0n ? (
            <button
              type="button"
              className="sk-btn pri"
              style={{ marginTop: 6 }}
              disabled={busy}
              onClick={() =>
                sendStakingTx(SITE_CONFIG.STAKING, SEL.claimAll, 'ETH rewards claimed.')
              }
            >
              Claim
            </button>
          ) : (
            <em>Claimable any time</em>
          )}
        </div>
      </div>

      <div className="sk-grid">
        <div className="bcard">
          <div className="bbox">
            <div className="brow">
              <span className="blab">Stake</span>
              <span className="sm muted">
                {walletManager.extAccount && u ? `Balance ${fmtUnits(u.bal, decimals, 2)}` : ''}
              </span>
            </div>
            <div className="bamt">
              <input
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                disabled={busy}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.');
                  if (/^\d*\.?\d*$/.test(v)) setAmount(v);
                }}
              />
              <span className="bsym">{SITE_CONFIG.TICKER}</span>
            </div>
            {walletManager.extAccount && u && u.bal > 0n ? (
              <div className="bbal">
                <span />
                <button
                  type="button"
                  onClick={() => setAmount(fmtUnits(u.bal, decimals, decimals).replace(/,/g, ''))}
                >
                  Max
                </button>
              </div>
            ) : null}
          </div>

          <div className="blab">Lock period</div>
          <div className="sk-tiers">
            {g.tiers.map((tr: any, i: number) => (
              <button
                key={i}
                type="button"
                className={`sk-tier ${tier === i ? 'on' : ''}`}
                onClick={() => setTier(i)}
              >
                <span className="sk-td">{days(tr.duration)} days</span>
                <span className="sk-tm">{mult(tr.bps)}</span>
                <span className="sk-tl">Weight</span>
              </button>
            ))}
          </div>

          <div className="bq">
            <div>
              <span>Reward weight</span>
              <span className="mono">
                {amt > 0n ? fmtUnits((amt * t.bps) / 10000n, decimals, 2) : '0'}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="bgo"
            disabled={busy || (walletManager.extAccount ? amt <= 0n || (u && amt > u.bal) : false)}
            onClick={() => {
              if (!walletManager.extAccount) {
                onOpenWallet();
                return;
              }
              if (needApprove) {
                sendStakingTx(
                  SITE_CONFIG.CA,
                  SEL.approve + addrWord(SITE_CONFIG.STAKING) + word(amt),
                  'Approved. Now confirm the stake.'
                );
              } else {
                sendStakingTx(
                  SITE_CONFIG.STAKING,
                  SEL.stake + word(amt) + word(tier),
                  `Staked ${fmtUnits(amt, decimals, 2)} ${SITE_CONFIG.TICKER}.`
                );
              }
            }}
          >
            {busy
              ? 'Working…'
              : !walletManager.extAccount
                ? 'Connect wallet'
                : needApprove
                  ? `Approve ${SITE_CONFIG.TICKER}`
                  : 'Stake'}
          </button>

          {err ? <div className="berr">{err}</div> : null}
          {ok ? (
            <div className="bdone">
              <span>
                {ok}{' '}
                {lastTx ? (
                  <a
                    href={`${SITE_CONFIG.EXPLORER}/tx/${lastTx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View transaction
                  </a>
                ) : null}
              </span>
            </div>
          ) : null}
        </div>

        <div className="card sk-card">
          <div className="sk-ct">
            <h2>Your positions</h2>
            <span className="muted sm">
              Contract:{' '}
              <button type="button" className="cp" onClick={() => onCopy(SITE_CONFIG.STAKING)}>
                {SITE_CONFIG.STAKING.slice(0, 6)}…{SITE_CONFIG.STAKING.slice(-4)} ⧉
              </button>
            </span>
          </div>
          {!u || !u.positions.length ? (
            <div className="empty">No staking positions yet.</div>
          ) : (
            <div className="tblwrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Amount</th>
                    <th>Lock</th>
                    <th>Rewards</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {u.positions.map((p: any) => {
                    const unlocked = Date.now() / 1000 >= Number(p.unlockAt);
                    return (
                      <tr key={p.id}>
                        <td className="mono">{fmtUnits(p.amount, decimals, 2)}</td>
                        <td>{p.withdrawn ? 'Withdrawn' : unlocked ? 'Unlocked' : 'Locked'}</td>
                        <td className="mono">{fmtUnits(pendingOf(p), 18, 6)} ETH</td>
                        <td style={{ textAlign: 'right' }}>
                          {!p.withdrawn && unlocked ? (
                            <button
                              type="button"
                              className="sk-btn pri"
                              disabled={busy}
                              onClick={() =>
                                sendStakingTx(
                                  SITE_CONFIG.STAKING,
                                  SEL.withdraw + word(p.id),
                                  'Tokens withdrawn.'
                                )
                              }
                            >
                              Withdraw
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
