import AsyncStorage from '@react-native-async-storage/async-storage';
import { Connection, PublicKey } from '@solana/web3.js';
import { create } from 'zustand';
import { FEE_BPS, FEE_WALLET, RPC_URL } from './config';
import {
  classifyDust,
  fetchDustQuotes,
  getSolPriceUsd,
  PricedBalance,
  priceTokens,
  selectQuoteTargets,
} from './core/price';
import { EmptyAccount, scanWallet } from './core/scan';
import {
  buildCloseTransactions,
  explainSimulationError,
  SweepSummary,
  waitForConfirmations,
} from './core/sweep';
import {
  connect,
  signAndSendTransactions,
  WalletSession,
} from './core/wallet';

const LAST_ADDRESS_KEY = 'sweeper:lastAddress';

export interface ScanResults {
  owner: string;
  emptyAccounts: EmptyAccount[];
  priced: PricedBalance[];
  solPriceUsd: number | null;
}

export interface QuoteProgress {
  done: number;
  total: number;
}

export interface SweepReceipt {
  signatures: string[];
  summary: SweepSummary;
}

interface SweeperState {
  address: string;
  loading: boolean;
  error: string | null;
  results: ScanResults | null;
  scanId: number;
  quoteProgress: QuoteProgress | null;
  wallet: WalletSession | null;
  connectError: string | null;
  sweeping: boolean;
  confirming: boolean;
  sweepError: string | null;
  lastSweep: SweepReceipt | null;
  setAddress: (address: string) => void;
  restoreAddress: () => Promise<void>;
  scan: () => Promise<void>;
  connectWallet: () => Promise<void>;
  scanConnectedWallet: () => Promise<void>;
  sweepRent: () => Promise<void>;
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
  wallet: null,
  connectError: null,
  sweeping: false,
  confirming: false,
  sweepError: null,
  lastSweep: null,

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
          owner: owner.toBase58(),
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

  connectWallet: async () => {
    set({ connectError: null });
    try {
      const result = await connect();
      if (result.status === 'connected') {
        set({ wallet: result.session });
      } else if (result.status === 'no-wallet') {
        set({ connectError: 'No compatible wallet app installed' });
      }
      // cancelled: stay on the form silently
    } catch (e) {
      set({
        connectError: e instanceof Error ? e.message : 'Connect failed',
      });
    }
  },

  scanConnectedWallet: async () => {
    const wallet = get().wallet;
    if (!wallet) return;
    set({ address: wallet.address });
    await get().scan();
  },

  sweepRent: async () => {
    const { wallet, results } = get();
    if (!wallet || !results || results.emptyAccounts.length === 0) return;
    if (results.owner !== wallet.address) {
      set({ sweepError: 'Scanned address is not the connected wallet' });
      return;
    }

    set({ sweeping: true, sweepError: null, lastSweep: null });
    try {
      const owner = new PublicKey(wallet.address);
      const feeWallet = FEE_WALLET ? new PublicKey(FEE_WALLET) : owner;
      const { transactions, summary } = buildCloseTransactions(
        results.emptyAccounts,
        owner,
        feeWallet,
        FEE_BPS
      );
      const connection = new Connection(RPC_URL, 'confirmed');
      const { blockhash } = await connection.getLatestBlockhash();
      for (const tx of transactions) tx.recentBlockhash = blockhash;

      // fail in-app with a readable message instead of opaquely in the wallet
      for (const tx of transactions) {
        const sim = await connection.simulateTransaction(tx);
        if (sim.value.err != null) {
          set({
            sweeping: false,
            sweepError: explainSimulationError(sim.value.err, sim.value.logs),
          });
          return;
        }
      }

      const { signatures, session } = await signAndSendTransactions(
        wallet,
        transactions
      );
      set({
        sweeping: false,
        confirming: true,
        wallet: session,
        lastSweep: { signatures, summary },
        address: results.owner,
      });
      // rescanning before the RPC sees the closes would show stale results
      const outcome = await waitForConfirmations(connection, signatures);
      set({
        confirming: false,
        sweepError:
          outcome === 'failed' ? 'A sweep transaction failed on-chain' : null,
      });
      await get().scan();
    } catch (e) {
      set({
        sweeping: false,
        confirming: false,
        sweepError: e instanceof Error ? e.message : 'Sweep failed',
      });
    }
  },

  reset: () => {
    quoteAbort?.abort();
    set((state) => ({
      results: null,
      error: null,
      quoteProgress: null,
      confirming: false,
      sweepError: null,
      lastSweep: null,
      scanId: state.scanId + 1,
    }));
  },
}));
