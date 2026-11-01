// After a devnet walk: compare the numbers on screen with what moved on chain.
// Usage: node check.mjs <walk-out-dir> [verify.json]
// Without verify.json it asks the running bridge (GET /verify).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, verifyFile] = process.argv.slice(2);
if (!dir) throw new Error('usage: node check.mjs <walk-out-dir> [verify.json]');

const texts = (name) =>
  readFileSync(join(dir, name), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^text="(.*)"$/)?.[1])
    .filter((t) => t !== undefined && t !== '');

/** Lamports from "0.000716184 SOL" or "-0.000005 SOL". */
function lamports(s) {
  const m = s.match(/^-?(\d+)(?:\.(\d{1,9}))? SOL$/);
  if (!m) throw new Error(`not a SOL amount: ${s}`);
  return BigInt(m[1]) * 1_000_000_000n + BigInt((m[2] ?? '').padEnd(9, '0'));
}
/** The amount right after a label on the confirm screen. */
function after(lines, label) {
  const i = lines.findIndex((l) => l === label || l.startsWith(label));
  if (i < 0) throw new Error(`label not on screen: ${label}`);
  return lamports(lines[i + 1]);
}

const confirm = texts('3-confirm.txt');
const shown = {
  rent: after(confirm, 'Rent back'),
  fee: after(confirm, 'Noventia fee'),
  network: after(confirm, 'Network fee'),
  receive: after(confirm, 'You receive'),
};
const select = [...texts('2-select.txt'), ...texts('2-select-bottom.txt')];
const result = texts('4-result.txt');

const report = verifyFile
  ? JSON.parse(readFileSync(verifyFile, 'utf8'))
  : await (await fetch('http://127.0.0.1:8799/verify')).json();

const txs = report.transactions;
const sum = (f) => txs.reduce((s, t) => s + f(t), 0n);
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });

check('every signed transaction is on devnet and succeeded', txs.length > 0 && txs.every((t) => t.found && t.err === null), `${txs.length} transaction(s)`);
check('the fee transfer is inside the same transaction as the closes', txs.every((t) => t.feeInSameTransaction), txs.map((t) => t.instructions.join(', ')).join(' | '));
const feeMoved = sum((t) => t.feeTransferLamports.reduce((s, x) => s + BigInt(x), 0n));
const feeWalletGot = sum((t) => BigInt(t.feeWalletDeltaLamports));
check('fee shown = fee transferred = fee wallet balance change', shown.fee === feeMoved && feeMoved === feeWalletGot, `shown ${shown.fee}, transferred ${feeMoved}, fee wallet +${feeWalletGot}`);
const ownerGot = sum((t) => BigInt(t.ownerDeltaLamports));
check('"You receive" shown = owner balance change on chain', shown.receive === ownerGot, `shown ${shown.receive}, owner +${ownerGot}`);
const networkPaid = sum((t) => BigInt(t.networkFeeLamports));
check('network fee shown = network fee paid', shown.network === networkPaid, `shown ${shown.network}, paid ${networkPaid}`);
check('rent shown = fee + network fee + received', shown.rent === shown.fee + shown.network + shown.receive, `${shown.rent} = ${shown.fee} + ${shown.network} + ${shown.receive}`);
check('no signed transaction names the NFT or its mint', txs.every((t) => !t.touchesNft));
check('no signed transaction names the frozen account', txs.every((t) => !t.touchesFrozen));
const kept = (kind) => report.untouched.find((u) => u.kind === kind);
check('the NFT account still holds its 1 token', kept('nft')?.exists && kept('nft')?.amount === '1', JSON.stringify(kept('nft')));
check('the frozen account is still there, frozen', kept('frozen')?.exists && kept('frozen')?.state === 'frozen', JSON.stringify(kept('frozen')));
check('the account with a balance is still there', kept('balance')?.exists && kept('balance')?.amount === '1000000000', JSON.stringify(kept('balance')));
check('every selected empty account is closed', report.untouched.filter((u) => u.kind.startsWith('empty')).every((u) => !u.exists));
check('the screen named the frozen account and its reason', select.includes('Frozen by the token issuer'), 'left alone: Frozen by the token issuer');
check('the screen kept the NFT out', select.includes('NFTs, never closed'));
check('the result screen says Confirmed', result.includes('Confirmed'));

const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const md = [
  '| Check | Result | Detail |',
  '|---|---|---|',
  ...checks.map((c) => `| ${c.name} | ${c.ok ? 'pass' : 'FAIL'} | ${String(c.detail ?? '').replace(/\|/g, '/')} |`),
  '',
  'Signed by the app, on devnet:',
  ...txs.map((t) => `- [${t.signature}](${explorer(t.signature)})`),
].join('\n');
writeFileSync(join(dir, 'evidence.md'), md + '\n');
writeFileSync(join(dir, 'evidence.json'), JSON.stringify({ shown: Object.fromEntries(Object.entries(shown).map(([k, v]) => [k, String(v)])), checks, report }, null, 2));
console.log(md);
process.exit(checks.every((c) => c.ok) ? 0 : 1);
