import AsyncStorage from '@react-native-async-storage/async-storage';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
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
  ConfirmationOutcome,
  explainSimulationError,
  waitForSignatureOutcomes,
} from './core/sweep';
import { buildSweepPlan, SweepPlan } from './core/swap';
import {
  connect,
  signAndSendTransactions,
  WalletSession,
} from './core/wallet';

const LAST_ADDRESS_KEY = 'sweeper:lastAddress';

export type View = 'form' | 'results' | 'review' | 'done';

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

export interface SweepSelectionInput {
  emptyAccounts: EmptyAccount[];
  dustTokens: PricedBalance[];
}

export type SweepItemOutcome =
  | {
      kind: 'swap';
      mint: string;
      quotedSolOut: number;
      signature: string;
      status: ConfirmationOutcome;
    }
  | {
      kind: 'closes';
      accounts: number;
      rentLamports: number;
      includesFee: boolean;
      signature: string;
      status: ConfirmationOutcome;
    }
  | { kind: 'fee'; signature: string; status: ConfirmationOutcome };

export interface SweepOutcome {
  items: SweepItemOutcome[];
  swappedCount: number;
  totalSwaps: number;
  closedAccounts: number;
  totalAccounts: number;
  /** Actual where known (rent), quoted for swaps; net of fee when taken. */
  recoveredLamports: number;
  feeLamports: number;
  feeTaken: boolean;
  usdEstimate: number | null;
}

interface SweeperState {
  view: View;
  address: string;
  loading: boolean;
  error: string | null;
  results: ScanResults | null;
  scanId: number;
  quoteProgress: QuoteProgress | null;
  wallet: WalletSession | null;
  connectError: string | null;
  plan: SweepPlan | null;
  planning: boolean;
  executing: boolean;
  confirming: boolean;
  sweepError: string | null;
  outcome: SweepOutcome | null;
  setAddress: (address: string) => void;
  restoreAddress: () => Promise<void>;
  scan: () => Promise<void>;
  connectWallet: () => Promise<void>;
  scanConnectedWallet: () => Promise<void>;
  startReview: (selected: SweepSelectionInput) => Promise<void>;
  cancelReview: () => void;
  confirmSweep: () => Promise<void>;
  reset: () => void;
}

let quoteAbort: AbortController | null = null;
let planCounter = 0;

export const useSweeperStore = create<SweeperState>((set, get) => ({
  view: 'form',
  address: '',
  loading: false,
  error: null,
  results: null,
  scanId: 0,
  quoteProgress: null,
  wallet: null,
  connectError: null,
  plan: null,
  planning: false,
  executing: false,
  confirming: false,
  sweepError: null,
  outcome: null,

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
        view: 'results',
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

  startReview: async (selected) => {
    const { wallet, results } = get();
    if (!wallet || !results || wallet.address !== results.owner) return;
    const planId = ++planCounter;
    set({ view: 'review', planning: true, plan: null, sweepError: null });
    try {
      const plan = await buildSweepPlan({
        owner: results.owner,
        emptyAccounts: selected.emptyAccounts,
        dustTokens: selected.dustTokens,
        feeWallet: FEE_WALLET,
        feeBps: FEE_BPS,
        solPriceUsd: results.solPriceUsd,
      });
      if (planCounter !== planId || get().view !== 'review') return;
      set({ plan, planning: false });
    } catch (e) {
      if (planCounter !== planId || get().view !== 'review') return;
      set({
        planning: false,
        sweepError: e instanceof Error ? e.message : 'Failed to build plan',
      });
    }
  },

  cancelReview: () => {
    planCounter++;
    set({ view: 'results', plan: null, planning: false, sweepError: null });
  },

  confirmSweep: async () => {
    const { plan, wallet } = get();
    if (!plan || !wallet || plan.transactions.length === 0) return;
    set({ executing: true, sweepError: null });
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const { blockhash } = await connection.getLatestBlockhash();
      for (const item of plan.transactions) {
        if (item.transaction instanceof Transaction) {
          item.transaction.recentBlockhash = blockhash;
        }
      }

      for (const item of plan.transactions) {
        const sim =
          item.kind === 'swap'
            ? await connection.simulateTransaction(item.transaction, {
                sigVerify: false,
                replaceRecentBlockhash: true,
              })
            : await connection.simulateTransaction(item.transaction);
        if (sim.value.err != null) {
          set({
            executing: false,
            sweepError: explainSimulationError(sim.value.err, sim.value.logs),
          });
          return;
        }
      }

      const { signatures, session } = await signAndSendTransactions(
        wallet,
        plan.transactions.map((t) => t.transaction)
      );
      set({ executing: false, confirming: true, wallet: session });

      const statuses = await waitForSignatureOutcomes(connection, signatures);
      const items: SweepItemOutcome[] = plan.transactions.map((t, i) => {
        const signature = signatures[i] ?? '';
        const status = statuses[i] ?? 'timeout';
        if (t.kind === 'swap') {
          return {
            kind: 'swap',
            mint: t.mint,
            quotedSolOut: t.quotedSolOut,
            signature,
            status,
          };
        }
        if (t.kind === 'closes') {
          return {
            kind: 'closes',
            accounts: t.emptyAccounts.length,
            rentLamports: t.rentLamports,
            includesFee: t.includesFee,
            signature,
            status,
          };
        }
        return { kind: 'fee', signature, status };
      });

      let recoveredLamports = 0;
      let swappedCount = 0;
      let closedAccounts = 0;
      let feeTaken = false;
      for (const item of items) {
        if (item.status !== 'confirmed') continue;
        if (item.kind === 'swap') {
          swappedCount++;
          recoveredLamports += item.quotedSolOut;
        } else if (item.kind === 'closes') {
          closedAccounts += item.accounts;
          recoveredLamports += item.rentLamports;
          if (item.includesFee) {
            recoveredLamports -= plan.summary.feeLamports;
            feeTaken = true;
          }
        } else {
          recoveredLamports -= plan.summary.feeLamports;
          feeTaken = true;
        }
      }
      const solPriceUsd = get().results?.solPriceUsd ?? null;
      set({
        confirming: false,
        plan: null,
        view: 'done',
        outcome: {
          items,
          swappedCount,
          totalSwaps: plan.summary.tokensSwapped,
          closedAccounts,
          totalAccounts: plan.summary.accountsClosed,
          recoveredLamports,
          feeLamports: plan.summary.feeLamports,
          feeTaken,
          usdEstimate:
            solPriceUsd === null
              ? null
              : (recoveredLamports / 1e9) * solPriceUsd,
        },
      });
    } catch (e) {
      set({
        executing: false,
        confirming: false,
        sweepError: e instanceof Error ? e.message : 'Sweep failed',
      });
    }
  },

  reset: () => {
    quoteAbort?.abort();
    planCounter++;
    set((state) => ({
      view: 'form',
      results: null,
      error: null,
      quoteProgress: null,
      plan: null,
      planning: false,
      executing: false,
      confirming: false,
      sweepError: null,
      outcome: null,
      scanId: state.scanId + 1,
    }));
  },
}));
