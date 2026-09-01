import AsyncStorage from '@react-native-async-storage/async-storage';
import { Connection, PublicKey } from '@solana/web3.js';
import { create } from 'zustand';
import { RPC_URL } from './config';
import {
  classifyDust,
  fetchDustQuotes,
  getSolPriceUsd,
  PricedBalance,
  priceTokens,
  selectQuoteTargets,
} from './core/price';
import { EmptyAccount, scanWallet } from './core/scan';

const LAST_ADDRESS_KEY = 'sweeper:lastAddress';

export interface ScanResults {
  emptyAccounts: EmptyAccount[];
  priced: PricedBalance[];
  solPriceUsd: number | null;
}

export interface QuoteProgress {
  done: number;
  total: number;
}

interface SweeperState {
  address: string;
  loading: boolean;
  error: string | null;
  results: ScanResults | null;
  scanId: number;
  quoteProgress: QuoteProgress | null;
  setAddress: (address: string) => void;
  restoreAddress: () => Promise<void>;
  scan: () => Promise<void>;
  reset: () => void;
}

let quoteAbort: AbortController | null = null;

export const useSweeperStore = create<SweeperState>((set, get) => ({
  address: '',
  loading: false,
  error: null,
  results: null,
  scanId: 0,
  quoteProgress: null,

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

    quoteAbort?.abort();
    const scanId = get().scanId + 1;
    set({ scanId, loading: true, error: null, quoteProgress: null });
    AsyncStorage.setItem(LAST_ADDRESS_KEY, address).catch(() => {});

    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const scan = await scanWallet(connection, owner);
      const priced = await priceTokens(scan.nonEmptyAccounts);
      const solPriceUsd = await getSolPriceUsd();
      if (get().scanId !== scanId) return;

      const { dust } = classifyDust(priced);
      const targets = selectQuoteTargets(dust);
      const dustKeys = new Set(dust.map((d) => d.pubkey));
      const targetKeys = new Set(targets.map((t) => t.pubkey));
      const marked = priced.map((p): PricedBalance => {
        if (!dustKeys.has(p.pubkey)) return p;
        return {
          ...p,
          quoteStatus: targetKeys.has(p.pubkey) ? 'pending' : 'skipped',
        };
      });
      set({
        results: {
          emptyAccounts: scan.emptyAccounts,
          priced: marked,
          solPriceUsd,
        },
        loading: false,
        quoteProgress: { done: 0, total: targets.length },
      });

      quoteAbort = new AbortController();
      await fetchDustQuotes(
        targets,
        { signal: quoteAbort.signal },
        (pubkey, estimatedSolOut) => {
          if (get().scanId !== scanId) return;
          set((state) => {
            if (!state.results) return {};
            return {
              results: {
                ...state.results,
                priced: state.results.priced.map((p): PricedBalance =>
                  p.pubkey === pubkey
                    ? { ...p, quoteStatus: 'done', estimatedSolOut }
                    : p
                ),
              },
              quoteProgress: state.quoteProgress
                ? { ...state.quoteProgress, done: state.quoteProgress.done + 1 }
                : null,
            };
          });
        }
      );
    } catch (e) {
      if (get().scanId !== scanId) return;
      set({
        error: e instanceof Error ? e.message : 'Scan failed',
        loading: false,
      });
    }
  },

  reset: () => {
    quoteAbort?.abort();
    set((state) => ({
      results: null,
      error: null,
      quoteProgress: null,
      scanId: state.scanId + 1,
    }));
  },
}));
