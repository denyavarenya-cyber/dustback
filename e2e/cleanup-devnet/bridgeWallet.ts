// Harness only. The CleanupWallet interface, backed by the devnet test wallet
// bridge on the host (adb reverse tcp:8799). The key never comes here.
import type { CleanupWallet } from '../src/features/cleanup/wallet/types';

const BRIDGE = 'http://127.0.0.1:8799';

export const cleanupWallet: CleanupWallet = {
  choices() {
    return [{ id: 'devnet-test', name: 'devnet test wallet' }];
  },
  async connect() {
    const r = await fetch(`${BRIDGE}/address`);
    if (!r.ok) throw new Error('test wallet unavailable');
    return (await r.json()) as { address: string };
  },
  async signTransactions(transactions) {
    const r = await fetch(`${BRIDGE}/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactions }),
    });
    const body = (await r.json()) as { signed?: string[]; error?: string };
    if (!r.ok || !body.signed) throw new Error(body.error ?? 'test wallet refused');
    return body.signed;
  },
  async disconnect() {},
};
