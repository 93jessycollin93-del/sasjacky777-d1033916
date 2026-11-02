import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { initTelegramWebApp, isTelegramWebApp, getTelegramUser, type TelegramUser } from '@/lib/telegram';
import {
  getPersistedWalletState,
  persistWalletState,
  TON_CONNECT_AVAILABLE,
  TON_CONNECT_DETAIL,
  type WalletState,
} from '@/lib/ton-wallet';

interface TelegramContextValue {
  isTelegram: boolean;
  user: TelegramUser | null;
  wallet: WalletState;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  platform: 'telegram' | 'web';
}

const TelegramContext = createContext<TelegramContextValue>({
  isTelegram: false,
  user: null,
  wallet: { status: 'disconnected', address: null, balance: null, network: null, lastConnected: null },
  connectWallet: async () => {},
  disconnectWallet: () => {},
  platform: 'web',
});

export const useTelegram = () => useContext(TelegramContext);

export function TelegramProvider({ children }: { children: ReactNode }) {
  const [isTg] = useState(() => isTelegramWebApp());
  const [user] = useState(() => getTelegramUser());
  const [wallet, setWallet] = useState<WalletState>(getPersistedWalletState);

  useEffect(() => {
    if (isTg) initTelegramWebApp();
  }, [isTg]);

  const connectWallet = async () => {
    // TODO: wire @tonconnect/ui-react here; until then this reports honestly
    // rather than staging a connection attempt.
    //
    // It used to show "Connecting…" for 1.5 seconds and then land back on the
    // same "Connect Wallet" label, having done nothing and explained nothing.
    // A button that cannot work should say so the moment it is pressed.
    if (!TON_CONNECT_AVAILABLE) {
      const state: WalletState = {
        status: 'unavailable',
        address: null,
        balance: null,
        network: null,
        lastConnected: null,
        detail: TON_CONNECT_DETAIL,
      };
      setWallet(state);
      persistWalletState(state);
      return;
    }
  };

  const disconnectWallet = () => {
    const state: WalletState = {
      status: 'disconnected',
      address: null,
      balance: null,
      network: null,
      lastConnected: null,
    };
    setWallet(state);
    persistWalletState(state);
  };

  return (
    <TelegramContext.Provider value={{
      isTelegram: isTg,
      user,
      wallet,
      connectWallet,
      disconnectWallet,
      platform: isTg ? 'telegram' : 'web',
    }}>
      {children}
    </TelegramContext.Provider>
  );
}
