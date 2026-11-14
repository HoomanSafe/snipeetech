import { useEffect, useState } from 'react';
import { shortAddr } from '../lib/format';
import { walletManager } from '../lib/walletManager';

export function WalletButton({
  small = false,
  onClick,
}: {
  small?: boolean;
  onClick: () => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => walletManager.subscribe(() => setTick((t) => t + 1)), []);

  const cls = small ? 'sm' : '';
  if (walletManager.mode === 'tw') {
    if (!walletManager.twExists()) {
      return (
        <button type="button" className={`wbtn ${cls}`} onClick={onClick}>
          Set up trading wallet
        </button>
      );
    }
    if (!walletManager.twUnlocked()) {
      return (
        <button type="button" className={`wbtn tw lockd ${cls}`} onClick={onClick}>
          <span className="dot" />
          Unlock wallet
        </button>
      );
    }
    const addr = walletManager.twAddress() || '';
    return (
      <button type="button" className={`wbtn tw on ${cls}`} onClick={onClick} title={addr}>
        <span className="dot" />
        <span className="mono">{shortAddr(addr)}</span>
      </button>
    );
  }

  if (walletManager.extAccount) {
    return (
      <button
        type="button"
        className={`wbtn on ${cls}`}
        onClick={onClick}
        title={walletManager.extAccount}
      >
        {walletManager.extInfo?.icon ? (
          <img src={walletManager.extInfo.icon} alt="" width={18} height={18} style={{ borderRadius: 4 }} />
        ) : (
          <span className="dot" />
        )}
        <span className="mono">{shortAddr(walletManager.extAccount)}</span>
      </button>
    );
  }

  return (
    <button type="button" className={`wbtn ${cls}`} onClick={onClick}>
      Connect wallet
    </button>
  );
}
