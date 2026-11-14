import { useEffect, useState } from 'react';
import { fmtUnits } from '../lib/sniperTrade';
import { walletManager } from '../lib/walletManager';

interface WalletModalProps {
  open: boolean;
  initialTab?: 'tw' | 'ext';
  onClose: () => void;
  onCopy: (text: string) => void;
}

export function WalletModal({ open, initialTab, onClose, onCopy }: WalletModalProps) {
  const [tab, setTab] = useState<'tw' | 'ext'>(initialTab || walletManager.mode);
  const [step, setStep] = useState<'intro' | 'create' | 'import'>('intro');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [keyIn, setKeyIn] = useState('');
  const [unlockPw, setUnlockPw] = useState('');
  const [withdrawTo, setWithdrawTo] = useState('');
  const [exportPw, setExportPw] = useState('');
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  const [qrSvg, setQrSvg] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [confirmForget, setConfirmForget] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    return walletManager.subscribe(() => setTick((t) => t + 1));
  }, []);

  useEffect(() => {
    if (!open) {
      setRevealedKey(null);
      setErr('');
      setOk('');
      setPw('');
      setPw2('');
      setKeyIn('');
      setUnlockPw('');
      setExportPw('');
      setConfirmForget(false);
      setStep('intro');
      return;
    }
    setConfirmForget(false);
    setTab(initialTab || walletManager.mode);
    walletManager.requestWallets();
  }, [open, initialTab]);

  const twAddress = walletManager.twAddress();
  const twUnlocked = walletManager.twUnlocked();

  useEffect(() => {
    if (!open || !twAddress) {
      setQrSvg('');
      return;
    }
    walletManager
      .qrSvg(twAddress, 132)
      .then(setQrSvg)
      .catch(() => setQrSvg(''));
  }, [open, twAddress]);

  useEffect(() => {
    if (!open || !twUnlocked) return;
    let alive = true;
    const loadBal = async () => {
      try {
        const b = await walletManager.twBalance();
        if (alive) setBal(b);
      } catch {
        // ignore RPC poll hiccup
      }
    };
    loadBal();
    const id = setInterval(() => {
      if (!document.hidden) loadBal();
    }, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open, twUnlocked]);

  if (!open) return null;

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await fn();
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const rec = walletManager.twRec();
  const backupKey = walletManager.backupKey();
  const extOpts = walletManager.walletOptions();

  return (
    <div
      className="bmodal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bpick tw-p" role="dialog" aria-label="Wallet">
        <div className="tw-h">
          <b>Wallet</b>
          <button type="button" className="tw-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="seg tw-tabs">
          <button
            type="button"
            className={tab === 'tw' ? 'on' : ''}
            onClick={() => {
              setTab('tw');
              setErr('');
              setOk('');
            }}
          >
            Trading wallet
          </button>
          <button
            type="button"
            className={tab === 'ext' ? 'on' : ''}
            onClick={() => {
              setTab('ext');
              setErr('');
              setOk('');
              walletManager.requestWallets();
            }}
          >
            Browser wallet
          </button>
        </div>

        {tab === 'tw' ? (
          !walletManager.twExists() ? (
            step === 'create' ? (
              <div className="tw-form">
                <b>New trading wallet</b>
                <p className="muted sm">
                  A new wallet is created in this browser. Pick a password to encrypt it.
                </p>
                <input
                  type="password"
                  className="tw-in"
                  placeholder="Password (10+ characters)"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
                <input
                  type="password"
                  className="tw-in"
                  placeholder="Repeat password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                />
                <div className="tw-acts">
                  <button
                    type="button"
                    className="bgo"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        const bad = walletManager.checkPassword(pw, pw2);
                        if (bad) throw new Error(bad);
                        await walletManager.create(pw);
                        setPw('');
                        setPw2('');
                      })
                    }
                  >
                    Create wallet
                  </button>
                  <button
                    type="button"
                    className="sk-btn"
                    onClick={() => {
                      setStep('intro');
                      setErr('');
                    }}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : step === 'import' ? (
              <div className="tw-form">
                <b>Import a private key</b>
                <input
                  type="password"
                  className="tw-in"
                  placeholder="Private key (0x…)"
                  value={keyIn}
                  onChange={(e) => setKeyIn(e.target.value)}
                />
                <input
                  type="password"
                  className="tw-in"
                  placeholder="Password (10+ characters)"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
                <input
                  type="password"
                  className="tw-in"
                  placeholder="Repeat password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                />
                <div className="tw-acts">
                  <button
                    type="button"
                    className="bgo"
                    disabled={busy}
                    onClick={() =>
                      runAction(async () => {
                        const bad = walletManager.checkPassword(pw, pw2);
                        if (bad) throw new Error(bad);
                        await walletManager.importKey(keyIn, pw);
                        setKeyIn('');
                        setPw('');
                        setPw2('');
                      })
                    }
                  >
                    Import wallet
                  </button>
                  <button
                    type="button"
                    className="sk-btn"
                    onClick={() => {
                      setStep('intro');
                      setErr('');
                    }}
                  >
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div className="tw-intro">
                <b>Trade without popups</b>
                <p className="muted">
                  Create a trading wallet in this browser, send it some ETH, and every buy and sell
                  goes through in one click.
                </p>
                <div className="tw-choice">
                  <button type="button" className="bgo" onClick={() => setStep('create')}>
                    Create new wallet
                  </button>
                  <button type="button" className="sk-btn" onClick={() => setStep('import')}>
                    Import key
                  </button>
                </div>
              </div>
            )
          ) : !twUnlocked ? (
            <div className="tw-form">
              <div className="tw-addr">
                <span className="blab">Trading wallet</span>
                <b className="mono">{rec?.address}</b>
              </div>
              {walletManager.twLockReason() ? (
                <p className="muted sm">{walletManager.twLockReason()}</p>
              ) : null}
              <input
                type="password"
                className="tw-in"
                placeholder="Password"
                autoFocus
                value={unlockPw}
                onChange={(e) => setUnlockPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    runAction(async () => {
                      await walletManager.unlock(unlockPw);
                      setUnlockPw('');
                    });
                  }
                }}
              />
              <div className="tw-acts">
                <button
                  type="button"
                  className="bgo"
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      await walletManager.unlock(unlockPw);
                      setUnlockPw('');
                    })
                  }
                >
                  Unlock
                </button>
                <button
                  type="button"
                  className="sk-btn danger"
                  onClick={() => setConfirmForget(true)}
                >
                  Forget
                </button>
              </div>
              {confirmForget ? (
                <div className="bwarn high" style={{ flexDirection: 'column', gap: 8 }}>
                  <span>
                    Forget the trading wallet in this browser? Without a backup of the key, any
                    funds in it are lost.
                  </span>
                  <div className="tw-acts">
                    <button
                      type="button"
                      className="sk-btn danger"
                      onClick={() => {
                        walletManager.forget();
                        setBal(null);
                        setRevealedKey(null);
                        setConfirmForget(false);
                      }}
                    >
                      Confirm forget
                    </button>
                    <button
                      type="button"
                      className="sk-btn"
                      onClick={() => setConfirmForget(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : backupKey ? (
            <div className="tw-form">
              <b>Back up your key</b>
              <p className="muted sm">
                This key is the only way to restore the wallet. Save it somewhere safe and never share it.
              </p>
              <div className="tw-key mono">{backupKey}</div>
              <div className="tw-acts">
                <button type="button" className="sk-btn" onClick={() => onCopy(backupKey)}>
                  Copy key
                </button>
                <button type="button" className="bgo" onClick={() => walletManager.confirmBackup()}>
                  I saved my key
                </button>
              </div>
            </div>
          ) : (
            <div className="tw-live">
              <div className="tw-dep">
                <div
                  className="tw-qr"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <div className="tw-depinfo">
                  <span className="blab">Deposit ETH on Robinhood Chain</span>
                  <b className="mono tw-a">{rec?.address}</b>
                  <div className="tw-acts">
                    <button
                      type="button"
                      className="sk-btn"
                      onClick={() => rec?.address && onCopy(rec.address)}
                    >
                      Copy address
                    </button>
                    {walletManager.mode !== 'tw' ? (
                      <button
                        type="button"
                        className="sk-btn pri"
                        onClick={() => walletManager.setMode('tw')}
                      >
                        Use for trading
                      </button>
                    ) : (
                      <span className="tw-on">
                        <span className="dot" />
                        Trading with this wallet
                      </span>
                    )}
                  </div>
                  <div className="tw-bal">
                    <span>Balance</span>
                    <b className="mono">{bal != null ? `${fmtUnits(bal, 18, 5)} ETH` : '…'}</b>
                  </div>
                </div>
              </div>

              {revealedKey ? (
                <div className="tw-form">
                  <b>Private key</b>
                  <div className="tw-key mono">{revealedKey}</div>
                  <div className="tw-acts">
                    <button type="button" className="sk-btn" onClick={() => onCopy(revealedKey)}>
                      Copy key
                    </button>
                    <button type="button" className="sk-btn" onClick={() => setRevealedKey(null)}>
                      Hide
                    </button>
                  </div>
                </div>
              ) : null}

              <details className="tw-more">
                <summary>Withdraw, export, settings</summary>
                <div className="tw-form">
                  <span className="blab">Withdraw all ETH</span>
                  <div className="tw-row">
                    <input
                      type="text"
                      className="tw-in"
                      placeholder="Destination address 0x…"
                      value={withdrawTo}
                      onChange={(e) => setWithdrawTo(e.target.value)}
                    />
                    <button
                      type="button"
                      className="sk-btn pri"
                      disabled={busy}
                      onClick={() =>
                        runAction(async () => {
                          const r = await walletManager.withdrawAll(withdrawTo);
                          setOk(`Withdrew ${fmtUnits(r.amount, 18, 5)} ETH.`);
                          setWithdrawTo('');
                          setBal(await walletManager.twBalance());
                        })
                      }
                    >
                      Withdraw
                    </button>
                  </div>
                </div>

                <div className="tw-form">
                  <span className="blab">Export private key</span>
                  <div className="tw-row">
                    <input
                      type="password"
                      className="tw-in"
                      placeholder="Password"
                      value={exportPw}
                      onChange={(e) => setExportPw(e.target.value)}
                    />
                    <button
                      type="button"
                      className="sk-btn"
                      disabled={busy}
                      onClick={() =>
                        runAction(async () => {
                          const k = await walletManager.exportKey(exportPw);
                          setRevealedKey(k);
                          setExportPw('');
                        })
                      }
                    >
                      Show key
                    </button>
                  </div>
                </div>

                <div className="tw-form">
                  <span className="blab">Auto-lock</span>
                  <select
                    className="tw-in"
                    value={walletManager.idleMin()}
                    onChange={(e) => walletManager.setIdleMin(parseInt(e.target.value, 10))}
                  >
                    <option value={0}>When the tab closes</option>
                    <option value={15}>After 15 min idle</option>
                    <option value={60}>After 1 h idle</option>
                    <option value={240}>After 4 h idle</option>
                  </select>
                </div>
              </details>

              <div className="tw-acts">
                <button
                  type="button"
                  className="sk-btn"
                  onClick={() => {
                    walletManager.lock('Locked.');
                    setRevealedKey(null);
                  }}
                >
                  Lock
                </button>
                <button
                  type="button"
                  className="sk-btn danger"
                  onClick={() => setConfirmForget(true)}
                >
                  Forget wallet
                </button>
              </div>
              {confirmForget ? (
                <div className="bwarn high" style={{ flexDirection: 'column', gap: 8 }}>
                  <span>
                    Forget the trading wallet in this browser? Without a backup of the key, any
                    funds in it are lost.
                  </span>
                  <div className="tw-acts">
                    <button
                      type="button"
                      className="sk-btn danger"
                      onClick={() => {
                        walletManager.forget();
                        setBal(null);
                        setRevealedKey(null);
                        setConfirmForget(false);
                      }}
                    >
                      Confirm forget
                    </button>
                    <button
                      type="button"
                      className="sk-btn"
                      onClick={() => setConfirmForget(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        ) : walletManager.extAccount ? (
          <div className="tw-form">
            <div className="tw-addr">
              <span className="blab">Browser wallet</span>
              <b className="mono">{walletManager.extAccount}</b>
            </div>
            <div className="tw-acts">
              {walletManager.mode !== 'ext' ? (
                <button type="button" className="bgo" onClick={() => walletManager.setMode('ext')}>
                  Use for trading
                </button>
              ) : (
                <span className="tw-on">
                  <span className="dot" />
                  Trading with this wallet
                </span>
              )}
              <button
                type="button"
                className="sk-btn"
                onClick={() => walletManager.disconnectExternal()}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="tw-form">
            <b>Connect a browser wallet</b>
            <p className="muted sm">Each trade is confirmed in your wallet.</p>
            {extOpts.length ? (
              extOpts.map((o) => (
                <button
                  key={o.info.uuid}
                  type="button"
                  className="tw-w"
                  disabled={busy}
                  onClick={() =>
                    runAction(async () => {
                      await walletManager.connectExternal(o, true);
                      walletManager.setMode('ext');
                    })
                  }
                >
                  {o.info.icon ? (
                    <img src={o.info.icon} alt="" width={24} height={24} />
                  ) : (
                    <span className="sp-ph sm">W</span>
                  )}
                  <span>{o.info.name}</span>
                </button>
              ))
            ) : (
              <p className="muted">
                No browser wallet found. Install MetaMask, Rabby or Coinbase Wallet, then reload.
              </p>
            )}
          </div>
        )}

        {err ? <div className="berr">{err}</div> : ok ? <div className="bdone">{ok}</div> : null}
      </div>
    </div>
  );
}
