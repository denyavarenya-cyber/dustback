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
  ConfirmationOutcome,
  explainSimulationError,
  waitForSignatureOutcomes,
} from './core/sweep';
import {
  buildFeeAndCloses,
  buildSwapTransactions,
  buildSweepPlan,
  SweepPlan,
} from './core/swap';
import {
  connect,
  signAndSendTransactions,
  WalletSession,
} from './core/wallet';

const LAST_ADDRESS_KEY = 'dustback:lastAddress';

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
  /** Fee actually attempted in phase 2, on rent + confirmed swaps only. */
  feeLamports: number;
  feeTaken: boolean;
  /** Set when swaps landed but the fee/closes phase could not be sent. */
  feePhaseError: string | null;
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
// invalidates in-flight confirmSweep continuations after reset/cancel
let sweepEpoch = 0;

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
    set({
      scanId,
      loading: true,
      error: null,
      quoteProgress: null,
      outcome: null,
      plan: null,
    });
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
    sweepEpoch++;
    set({ view: 'results', plan: null, planning: false, sweepError: null });
  },

  confirmSweep: async () => {
    const { plan, wallet } = get();
    if (!plan || !wallet || plan.transactions.length === 0) return;
    const epoch = sweepEpoch;
    const alive = () => sweepEpoch === epoch;
    set({ executing: true, sweepError: null });
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const swapInputs = plan.transactions.flatMap((t) =>
        t.kind === 'swap' ? [t] : []
      );
      const closeAccounts = plan.transactions.flatMap((t) =>
        t.kind === 'closes' ? t.emptyAccounts : []
      );

      const items: SweepItemOutcome[] = [];
      let session = wallet;
      let sentAnything = false;
      let confirmedSwapOut = 0;
      let swappedCount = 0;

      // phase 1: swaps, rebuilt fresh so the embedded blockhash is seconds
      // old at signing (a review-time build expires in under a minute)
      if (swapInputs.length > 0) {
        const buildStart = Date.now();
        const { swaps, skipped } = await buildSwapTransactions(
          swapInputs.map(({ mint, pubkey, amountRaw, decimals }) => ({
            mint,
            pubkey,
            amountRaw,
            decimals,
          })),
          wallet.address
        );
        if (!alive()) return;
        console.log(
          `[sweep] rebuilt ${swaps.length} swaps (${skipped.length} skipped) in ${
            Date.now() - buildStart
          }ms`
        );
        for (const s of skipped) {
          items.push({
            kind: 'swap',
            mint: s.mint,
            quotedSolOut: 0,
            signature: '',
            status: 'failed',
          });
        }

        if (swaps.length > 0) {
          for (const s of swaps) {
            const sim = await connection.simulateTransaction(s.transaction, {
              sigVerify: false,
            });
            if (sim.value.err != null) {
              console.log('[sweep] swap preflight failed', sim.value.err);
              set({
                executing: false,
                sweepError: explainSimulationError(
                  sim.value.err,
                  sim.value.logs
                ),
              });
              return;
            }
          }
          const sent = await signAndSendTransactions(
            session,
            swaps.map((s) => s.transaction)
          );
          session = sent.session;
          sentAnything = true;
          console.log(
            `[sweep] swaps sent ${Date.now() - buildStart}ms after build`,
            sent.signatures
          );
          if (!alive()) return;
          set({ executing: false, confirming: true, wallet: session });

          const outcomes = await waitForSignatureOutcomes(
            connection,
            sent.signatures
          );
          if (!alive()) return;
          console.log('[sweep] swap outcomes', outcomes);
          swaps.forEach((s, i) => {
            const status = outcomes[i] ?? 'timeout';
            if (status === 'confirmed') {
              confirmedSwapOut += s.quotedSolOut;
              swappedCount++;
            }
            items.push({
              kind: 'swap',
              mint: s.mint,
              quotedSolOut: s.quotedSolOut,
              signature: sent.signatures[i] ?? '',
              status,
            });
          });
        }
      }

      // phase 2: fee strictly on rent + CONFIRMED swap output; when nothing
      // confirmed and nothing closes, no fee transaction exists at all
      const phase2 = buildFeeAndCloses({
        emptyAccounts: closeAccounts,
        owner: wallet.address,
        feeWallet: FEE_WALLET,
        feeBps: FEE_BPS,
        swapSolOutLamports: confirmedSwapOut,
      });
      console.log(
        `[sweep] phase 2: ${phase2.transactions.length} txs, fee ${phase2.feeLamports} on confirmed ${confirmedSwapOut} + rent ${phase2.rentLamports}`
      );

      let closedAccounts = 0;
      let feeTaken = false;
      let feePhaseError: string | null = null;

      if (phase2.transactions.length > 0) {
        if (!alive()) return;
        set({ executing: true, confirming: false });
        const { blockhash } = await connection.getLatestBlockhash();
        for (const t of phase2.transactions) {
          t.transaction.recentBlockhash = blockhash;
        }
        let simError: string | null = null;
        for (const t of phase2.transactions) {
          const sim = await connection.simulateTransaction(t.transaction);
          if (sim.value.err != null) {
            simError = explainSimulationError(sim.value.err, sim.value.logs);
            break;
          }
        }
        if (simError !== null && !sentAnything) {
          set({ executing: false, sweepError: simError });
          return;
        }
        if (simError !== null) {
          feePhaseError = simError;
        } else {
          try {
            const sent2 = await signAndSendTransactions(
              session,
              phase2.transactions.map((t) => t.transaction)
            );
            session = sent2.session;
            sentAnything = true;
            if (!alive()) return;
            set({ executing: false, confirming: true, wallet: session });

            const outcomes2 = await waitForSignatureOutcomes(
              connection,
              sent2.signatures
            );
            if (!alive()) return;
            console.log('[sweep] phase 2 outcomes', outcomes2);
            phase2.transactions.forEach((t, i) => {
              const status = outcomes2[i] ?? 'timeout';
              const signature = sent2.signatures[i] ?? '';
              if (t.kind === 'closes') {
                if (status === 'confirmed') {
                  closedAccounts += t.emptyAccounts.length;
                  if (t.includesFee) feeTaken = true;
                }
                items.push({
                  kind: 'closes',
                  accounts: t.emptyAccounts.length,
                  rentLamports: t.rentLamports,
                  includesFee: t.includesFee,
                  signature,
                  status,
                });
              } else {
                if (status === 'confirmed') feeTaken = true;
                items.push({ kind: 'fee', signature, status });
              }
            });
          } catch (e) {
            if (!sentAnything) throw e;
            // swaps are already final; report instead of pretending
            feePhaseError =
              e instanceof Error ? e.message : 'Fee transaction not sent';
          }
        }
      }

      let recoveredLamports = confirmedSwapOut;
      for (const item of items) {
        if (item.kind === 'closes' && item.status === 'confirmed') {
          recoveredLamports += item.rentLamports;
        }
      }
      if (feeTaken) recoveredLamports -= phase2.feeLamports;

      const solPriceUsd = get().results?.solPriceUsd ?? null;
      if (!alive()) return;
      set({
        executing: false,
        confirming: false,
        plan: null,
        view: 'done',
        outcome: {
          items,
          swappedCount,
          totalSwaps: swapInputs.length,
          closedAccounts,
          totalAccounts: closeAccounts.length,
          recoveredLamports,
          feeLamports: phase2.feeLamports,
          feeTaken,
          feePhaseError,
          usdEstimate:
            solPriceUsd === null
              ? null
              : (recoveredLamports / 1e9) * solPriceUsd,
        },
      });
    } catch (e) {
      if (!alive()) return;
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
    sweepEpoch++;
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
