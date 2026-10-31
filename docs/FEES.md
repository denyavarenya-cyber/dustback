# Fees: swaps and wallet cleanup

Date: 31 October 2026. Prices and terms change; every figure below has its source and
the date it was read. Nothing here charges anyone yet: the code runs on devnet and
mainnet stays blocked until the owner approves it in writing.

## 1. Jupiter integrator fee: current terms

Jupiter's current Swap API is V2 at `https://api.jup.ag/swap/v2`. The older Metis
endpoints (`/swap/v1/quote` and `/swap/v1/swap`, used by DustBack) are marked
"no longer actively maintained" and superseded by V2.

| Point | Term | Source |
|---|---|---|
| Endpoint we use | `GET /swap/v2/build` (Router): returns raw instructions; we assemble, check and simulate the transaction ourselves | [Build](https://developers.jup.ag/docs/swap/build), [API reference](https://developers.jup.ag/docs/api-reference/swap/build.md) |
| Jupiter's own fee on `/build` | "Jupiter does not charge swap fees on `/build`." | [Build, Fees](https://developers.jup.ag/docs/swap/build#fees) |
| Our fee mechanism | "The only fee mechanism is integrator platform fees via `platformFeeBps` and `feeAccount`." "Your fee is added as part of the swap instruction." | same |
| Fee account | "can be any SPL token account you control"; "You are responsible for creating and managing this account." Must be initialized beforehand and hold the right mint. | same; [Add fees to swap](https://developers.jup.ag/docs/swap/add-fees-to-swap) |
| Fee mint | For ExactIn swaps (ours) the fee account's mint can be the input or the output mint. We take it in the output mint, wrapped SOL, so one account serves every swap. | [Add fees to swap](https://developers.jup.ag/docs/swap/add-fees-to-swap) |
| Range | `platformFeeBps` integer 0 to 10000; `feeAccount` required when above 0 | [API reference](https://developers.jup.ag/docs/api-reference/swap/build.md) |
| Token-2022 | "It supports SPL and Token2022 tokens." | [Add fees to swap](https://developers.jup.ag/docs/swap/add-fees-to-swap) |
| Jupiter's share of our fee | The `/build` pages do not mention a share. The other endpoint, `/order` with the Referral Program, takes 20 percent of the integrator fee (50 to 255 bps). Older pages mentioned a 2.5 percent share. **Confirm in writing with Jupiter before mainnet.** | [Fees for /order](https://developers.jup.ag/docs/swap/fees) |
| Rate limits | Keyless 0.5 requests per second; free key 1; paid plans 10 to 150. A key from the Jupiter Portal goes in the `x-api-key` header. | [Swap overview](https://developers.jup.ag/docs/swap), [Rate limits](https://developers.jup.ag/docs/portal/rate-limits.md) |
| Prices | `https://api.jup.ag/price/v3`, 50 mints per request; tokens without a reliable price are left out | [Price API](https://developers.jup.ag/docs/price) |

Why `/build` and not `/order`: `/order` returns a finished transaction and executes it
through Jupiter, with Jupiter's own fee of 0 to 50 bps per pair on top. `/build`
gives us the instructions, so we can refuse anything that is not a swap of the
selected token, add nothing hidden, and simulate exactly what the user signs.

## 2. What others charge today

Read on 31 October 2026. "Confirmed" means read on the product's own page or on a
project page that quotes it; "not confirmed" means only secondary sources were found.

### In-wallet swaps

| Product | Fee | Source | Status |
|---|---|---|---|
| Phantom (in-app swap, Solana) | 0.85 percent on most swaps | [Analytics Insight review 2026](https://www.analyticsinsight.net/cryptocurrency-analytics-insight/phantom-wallet-review-2026-features-fees-security-and-solana-support), [MadeOnSol guide](https://madeonsol.com/blog/phantom-wallet-guide) | Not confirmed; Phantom's help pages did not load |
| Solflare (in-app swap) | No percentage published; shown per quote | [Solflare help](https://help.solflare.com/en/articles/5758552-how-to-swap-tokens-using-solflare-mobile) | Confirmed that none is published |
| Jupiter `/order` (jup.ag) | 0 to 50 bps by pair; 10 bps for most pairs, 50 bps for tokens under 24 hours old | [Jupiter fees](https://developers.jup.ag/docs/swap/fees) | Confirmed |

### Rent reclaim and cleanup tools

| Product | Fee | Source | Status |
|---|---|---|---|
| Refund SOL | 2 percent of the SOL processed | [refundsol.app FAQ](https://refundsol.app/faq) | Confirmed |
| Unclaimed SOL | the greater of 2 percent or rent above 0.002 SOL, per closed account | [unclaimedsol.com](https://unclaimedsol.com/) | Confirmed |
| SolRecover | 1.9 percent | [solrecover.io](https://solrecover.io/blog/reclaim-rent-empty-solana-accounts/) | Confirmed |
| SOLTokenLab | 2 percent of recovered rent | [soltokenlab.com](https://www.soltokenlab.com/blog/reclaim-sol-from-empty-token-accounts) | Confirmed by search result only |
| Sol Incinerator | about 2 percent of reclaimed rent; about 5 percent for NFT burns | [Solana Compass](https://solanacompass.com/projects/sol-incinerator) | Project page, not the tool's own |
| Claim Your Sol | 5 percent, 1 percent on the first day of each month | [Solana Compass](https://solanacompass.com/projects/claim-your-sol) | Project page, not the tool's own |
| Slerf batch incinerator | 8 percent of recovered SOL (search snippet) | [slerf.tools](https://slerf.tools/en-us/batch-incinerator/solana) | Not confirmed; the page did not show it |
| DustBack (old) | 8 percent of rent plus swap output | `src/config.ts:10` | Our own code |

## 3. Recommendation

**Swap: 0.5 percent (50 bps), as drafted.** Below Phantom's 0.85 percent, above
Jupiter's own 0.1 percent for most pairs. On dust the fee in SOL is tiny either way;
on larger swaps 0.5 percent is in line with wallets. Keep it only if Jupiter confirms
it takes no share on `/build`.

**Cleanup: 3 percent of reclaimed rent (300 bps), not 10 percent.** The common price
today is about 2 percent (Refund SOL, Unclaimed SOL, SolRecover, Sol Incinerator); the
highest found is 5 to 8 percent. At 10 percent Noventia would be the most expensive
tool in the table, for the same on-chain action, in a product whose whole promise is
trust. 3 percent stays close to the market and is paid for by what the others do not
show: every fee is a separate instruction inside the same transaction, simulated before
signing, never charged on a transaction that fails.

What the difference means for one full transaction of 24 closed accounts
(24 × 0.00203928 = 0.04894272 SOL of rent):

| Rate | Fee | User receives (after 0.000005 network fee) |
|---|---|---|
| 2 percent | 0.000978854 SOL | 0.047958866 SOL |
| 3 percent | 0.001468281 SOL | 0.047469439 SOL |
| 10 percent | 0.004894272 SOL | 0.044043448 SOL |

Both values live in config (`cleanupFeeBps`, `swapFeeBps`), with hard caps of 20 and 2
percent in code so a typo cannot overcharge.

## 4. What the user sees before signing

Every number comes from the module and points to an account or a transaction.

**Cleanup** (one confirm screen, then the wallet):

```
Close 24 empty token accounts
Rent back             0.04894272 SOL    sum of the 24 accounts' lamports, listed below
Noventia fee (3%)    -0.001468281 SOL   to <fee wallet, shortened>, inside the same transaction
Network fee          -0.000005 SOL      1 transaction
You receive           0.047469439 SOL
[list: token, account, rent back per account]
```

In the wallet, each transaction shows the account closes plus one SOL transfer of the
exact fee to the fee wallet. If the user selected accounts that need more than one
transaction, the screen says how many signatures follow and each transaction carries
its own fee, so a transaction that fails costs no fee.

**Swap** (built right before the wallet opens, because the blockhash lives about a
minute):

```
Sell 1234.56789 TOKEN
Quote                 0.0021 SOL
At least              0.002079 SOL       slippage 1%; the swap fails below this
Noventia fee (0.5%)  -0.0000105 SOL      measured in the simulation of this transaction
Network fee          -0.000014 SOL       base fee plus priority fee
Route                 Whirlpool
```

The wallet shows the swap with the fee already deducted from the output, because
Jupiter takes it inside the swap instruction.

## 5. The fee wallet

The owner creates it and gives only its public address. The code never sees a key.

1. Create a new wallet used for nothing else (a hardware wallet, or a separate account
   whose recovery phrase is kept offline). Do not reuse the DustBack fee wallet
   `G91pHLGZPpcQnp1rCjxThCPky91bQJSgaPSUNMZL5aH`: it carries DustBack history,
   including the 1 September double charge.
2. Fund it once with at least 0.001 SOL, so that a small fee transfer cannot fail the
   rent minimum (0.00089088 SOL for a plain account). On devnet, use the faucet at
   `faucet.solana.com`.
3. Create its wrapped SOL token account (mint `So11111111111111111111111111111111111111112`),
   once per cluster. This account receives the swap fees. With the Solana CLI on the
   owner's own machine: `spl-token create-account So11111111111111111111111111111111111111112 --owner <FEE_WALLET>`.
   Send the resulting account address too; it goes into `swapFeeTokenAccount`. The
   module checks before every swap that this account belongs to the fee wallet.
4. The same public address works on devnet and mainnet; balances are separate.

**Collection.** Nothing to claim. Cleanup fees arrive as SOL in the fee wallet inside
the user's own transaction. Swap fees arrive as wrapped SOL in the fee wallet's
wrapped SOL account. To move wrapped SOL out, send it as a token; do not close that
account, or swap fees stop until it is created again.

**How the owner sees fees.**

* Every fee is an on-chain transfer: `https://explorer.solana.com/address/<FEE_WALLET>`
  (add `?cluster=devnet` for devnet). Each entry links to the user's transaction, which
  shows the accounts closed or the swap made, so every fee traces back to what it was
  charged for.
* The same for the wrapped SOL account.
* Later: a read-only daily summary built from those transactions (see `docs/BACKLOG.md`).

**If the fee wallet is ever exposed**: change `feeWallet` and `swapFeeTokenAccount` in
config and ship. Users' funds are never at risk from it: it only receives.
