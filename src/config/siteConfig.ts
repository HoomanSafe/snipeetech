export const SITE_CONFIG = {
  PROJECT_NAME: 'SNIPETECH',
  TICKER: 'SNIPETECH',
  CA: (import.meta.env.VITE_TOKEN_CA || '').trim(),
  X_URL: 'https://x.com/Snipetech',
  X_HANDLE: 'Snipetech',
  LOGO_SRC: '/assets/aistudio/image_7bee3777.png',
  STAKING: (import.meta.env.VITE_STAKING_CA || '').trim(),
  SNIPER: true,
  SNIPER_ROUTER: '0xcb97C4140B125dC2F92555F83a39d80A2b6eF57e',
  BUY_URL: 'https://ponsfamily.com/launchpad/',
  CHAIN_ID: 4663,
  CHAIN_NAME: 'Robinhood Chain',
  RPC_URL: 'https://rpc.mainnet.chain.robinhood.com',
  EXPLORER: 'https://robinhoodchain.blockscout.com',
  PONS_URL: 'https://ponsfamily.com',
} as const;

export const isValidAddr = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(String(a || '').trim());
export const STAKING_LIVE = isValidAddr(SITE_CONFIG.STAKING);
export const SNIPER_LIVE = SITE_CONFIG.SNIPER && isValidAddr(SITE_CONFIG.SNIPER_ROUTER);
