// Mainnet simulation of one cleanup: the module's own scan and prepare (build,
// then simulate twice), counting every RPC call. Nothing is signed or sent: the
// transport refuses sendTransaction and requestAirdrop outright.
//   npx esbuild@0.28.2 measure.ts --bundle --platform=node --format=esm --outfile=measure.mjs
//   node measure.mjs <owner> <an existing account as the simulated fee recipient> [accounts] [rpc url]
import {
  createConfig,
  createHttpTransport,
  FEE_WALLET_PLACEHOLDER,
  prepareCleanup,
  scanWallet,
  type RpcTransport,
} from '../../packages/cleanup-core/src/index';

const [owner, feeWallet, nArg, rpcArg] = process.argv.slice(2);
const N = Number(nArg ?? 24);
const RPC = rpcArg ?? 'https://api.mainnet-beta.solana.com';

const http = { requests: 0 };
const countingFetch: typeof fetch = (input, init) => {
  http.requests++;
  return fetch(input, init);
};
const base = createHttpTransport(RPC, { fetchImpl: countingFetch, timeoutMs: 30_000, retry: { attempts: 8 } });
const calls: Record<string, number> = {};
const rpc: RpcTransport = async (method, params) => {
  if (/^(send|request)/i.test(method)) throw new Error(`refused in the measurement: ${method}`);
  calls[method] = (calls[method] ?? 0) + 1;
  return base(method, params);
};
const snapshot = () => ({ ...calls });
const diff = (a: Record<string, number>, b: Record<string, number>) =>
  Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]).filter(([, v]) => (v as number) > 0));

const config = createConfig({
  cluster: 'mainnet-beta',
  // Simulation only in this script: prepareCleanup needs it, and nothing here can send.
  allowMainnet: true,
  cleanupFeeBps: 700,
  feeWallet,
  swapFeeTokenAccount: FEE_WALLET_PLACEHOLDER,
});

const t0 = Date.now();
const before = snapshot();
const scan = await scanWallet({ rpc, owner, config });
const afterScan = snapshot();
const t1 = Date.now();
const closable = scan.accounts.filter((a) => a.closable);
const close = closable.slice(0, N).map((a) => a.address);
const offer = await prepareCleanup({ rpc, scan, selection: { close }, config, platform: 'web' });
const afterPrepare = snapshot();
const t2 = Date.now();

const big = (v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
console.log(
  JSON.stringify(
    {
      accountsInWallet: scan.accounts.length,
      closableInWallet: closable.length,
      selected: close.length,
      scanCalls: diff(before, afterScan),
      prepareCalls: diff(afterScan, afterPrepare),
      totalCalls: Object.values(afterPrepare).reduce((a, b) => a + b, 0),
      httpRequestsIncludingRetries: http.requests,
      ms: { scan: t1 - t0, prepare: t2 - t1 },
      transactions: offer.transactions.map((t) => ({
        accounts: t.accounts.length,
        bytes: t.bytes,
        computeUnitLimit: t.computeUnitLimit,
        unitsConsumed: t.unitsConsumed,
        rent: big(t.rentLamports),
        fee: big(t.fee?.lamports ?? 0n),
        networkFee: big(t.networkFeeLamports),
        net: big(t.netLamports),
      })),
      rejected: offer.rejected.map((r) => ({ accounts: r.accounts.length, reason: r.reason })),
      totals: Object.fromEntries(Object.entries(offer.totals).map(([k, v]) => [k, big(v)])),
    },
    null,
    2,
  ),
);
