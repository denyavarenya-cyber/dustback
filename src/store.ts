import AsyncStorage from '@react-native-async-storage/async-storage';
import { Connection, PublicKey } from '@solana/web3.js';
import { create } from 'zustand';
import { RPC_URL } from './config';
import { getSolPriceUsd, PricedBalance, priceTokens } from './core/price';
import { EmptyAccount, scanWallet } from './core/scan';

const LAST_ADDRESS_KEY = 'sweeper:lastAddress';

export interface ScanResults {
  emptyAccounts: EmptyAccount[];
  priced: PricedBalance[];
  solPriceUsd: number | null;
}

interface SweeperState {
  address: string;
  loading: boolean;
  error: string | null;
  results: ScanResults | null;
  setAddress: (address: string) => void;
  restoreAddress: () => Promise<void>;
  scan: () => Promise<void>;
  reset: () => void;
}

export const useSweeperStore = create<SweeperState>((set, get) => ({
  address: '',
  loading: false,
  error: null,
  results: null,

  setAddress: (address) => set({ address }),

  restoreAddress: async () => {
    try {
      const saved = await AsyncStorage.getItem(LAST_ADDRESS_KEY);
      if (saved && !get().address) set({ address: saved });
    } catch {
      // start with an empty input
    }
  },

  scan: async () => {
    const address = get().address.trim();
    let owner: PublicKey;
    try {
      owner = new PublicKey(address);
    } catch {
      set({ error: 'Invalid wallet address' });
      return;
    }

    set({ loading: true, error: null });
    AsyncStorage.setItem(LAST_ADDRESS_KEY, address).catch(() => {});
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const scan = await scanWallet(connection, owner);
      const priced = await priceTokens(scan.nonEmptyAccounts);
      const solPriceUsd = await getSolPriceUsd();
      set({
        results: { emptyAccounts: scan.emptyAccounts, priced, solPriceUsd },
        loading: false,
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : 'Scan failed',
        loading: false,
      });
    }
  },

  reset: () => set({ results: null, error: null }),
}));
