// Devnet test wallet for the cleanup end-to-end run. Not part of the app.
//
// Keys are generated in this process with WebCrypto as non-extractable
// CryptoKeys: there is no seed, no secret bytes to print or save, and they are
// gone when the process exits. The process talks only to devnet and refuses to
// start or sign if the RPC is not devnet.
//
// The app on the emulator reaches this through `adb reverse tcp:8799`.
import http from 'node:http';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  signTransactionMessageWithSigners,
} from '@solana/kit';

const RPC_URL = 'https://api.devnet.solana.com';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PORT = 8799;

const SYSTEM = address('11111111111111111111111111111111');
const TOKEN = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN22 = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

const rpc = createSolanaRpc(RPC_URL);
const addr = getAddressEncoder();
const b64in = getBase64Encoder();
const b64out = getBase64Decoder();
const b58 = getBase58Decoder();
const txDecoder = getTransactionDecoder();
const txEncoder = getTransactionEncoder();
const msgDecoder = getCompiledTransactionMessageDecoder();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const json = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2);

function u64(n) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}
function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}
function cat(...parts) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

// ─── Devnet guard ──────────────────────────────────────────────────────────
const genesis = await rpc.getGenesisHash().send();
if (genesis !== DEVNET_GENESIS) throw new Error(`not devnet: ${genesis}`);
log('cluster devnet, genesis', genesis);

// ─── Throwaway keys, in memory only ────────────────────────────────────────
const owner = await generateKeyPairSigner();
const feeWallet = await generateKeyPairSigner();
log('owner', owner.address, 'extractable:', owner.keyPair.privateKey.extractable);
log('fee wallet', feeWallet.address);

async function confirm(signature, what) {
  for (let i = 0; i < 90; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const s = value[0];
    if (s?.err) throw new Error(`${what} failed: ${json(s.err)}`);
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return;
    await sleep(1000);
  }
  throw new Error(`${what} not confirmed: ${signature}`);
}

const setup = [];
async function send(what, instructions) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const tx = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(tx);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  await confirm(signature, what);
  setup.push({ what, signature });
  log('setup', what, signature);
  return signature;
}

const signerMeta = (s, writable) => ({ address: s.address, role: writable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER, signer: s });
const w = (a) => ({ address: a, role: AccountRole.WRITABLE });
const ro = (a) => ({ address: a, role: AccountRole.READONLY });

const ix = {
  createAccount: (account, lamports, space, programOwner) => ({
    programAddress: SYSTEM,
    accounts: [signerMeta(owner, true), signerMeta(account, true)],
    data: cat(u32(0), u64(lamports), u64(space), addr.encode(programOwner)),
  }),
  transfer: (to, lamports) => ({ programAddress: SYSTEM, accounts: [signerMeta(owner, true), w(to)], data: cat(u32(2), u64(lamports)) }),
  initializeMint2: (program, mint, decimals, freeze) => ({
    programAddress: program,
    accounts: [w(mint)],
    data: cat(Uint8Array.of(20, decimals), addr.encode(owner.address), freeze ? cat(Uint8Array.of(1), addr.encode(owner.address)) : Uint8Array.of(0)),
  }),
  createAta: (program, ata, mint) => ({
    programAddress: ATA_PROGRAM,
    accounts: [signerMeta(owner, true), w(ata), ro(owner.address), ro(mint), ro(SYSTEM), ro(program)],
    data: Uint8Array.of(1),
  }),
  mintTo: (program, mint, ata, amount) => ({ programAddress: program, accounts: [w(mint), w(ata), signerMeta(owner, false)], data: cat(Uint8Array.of(7), u64(amount)) }),
  freeze: (program, ata, mint) => ({ programAddress: program, accounts: [w(ata), ro(mint), signerMeta(owner, false)], data: Uint8Array.of(10) }),
  dropMintAuthority: (program, mint) => ({ programAddress: program, accounts: [w(mint), signerMeta(owner, false)], data: Uint8Array.of(6, 0, 0) }),
};

async function ataOf(program, mint) {
  const [pda] = await getProgramDerivedAddress({ programAddress: ATA_PROGRAM, seeds: [addr.encode(owner.address), addr.encode(program), addr.encode(mint)] });
  return pda;
}

const mintRent = await rpc.getMinimumBalanceForRentExemption(82n).send();

/** One mint and the owner's account for it, set up as `kind`. */
async function makeAccount(kind, program = TOKEN) {
  const mint = await generateKeyPairSigner();
  const ata = await ataOf(program, mint.address);
  const decimals = kind === 'nft' ? 0 : 6;
  const list = [
    ix.createAccount(mint, mintRent, 82n, program),
    ix.initializeMint2(program, mint.address, decimals, kind === 'frozen'),
    ix.createAta(program, ata, mint.address),
  ];
  if (kind === 'nft') list.push(ix.mintTo(program, mint.address, ata, 1n), ix.dropMintAuthority(program, mint.address));
  if (kind === 'balance') list.push(ix.mintTo(program, mint.address, ata, 1_000_000_000n));
  if (kind === 'frozen') list.push(ix.freeze(program, ata, mint.address));
  await send(`${kind} account (${program === TOKEN ? 'Token' : 'Token-2022'})`, list);
  return { kind, program: program === TOKEN ? 'token' : 'token2022', mint: mint.address, account: ata };
}

// ─── Funding ───────────────────────────────────────────────────────────────
// The RPC faucet on devnet is closed (HTTP 410 since 2026). Try it once, then
// wait for someone to send devnet SOL to the owner address from
// https://faucet.solana.com (captcha or GitHub sign-in). The wait is
// FUND_WAIT_MIN minutes (default 60); the address dies with this process, so
// set it long enough for the person who funds it.
const NEEDED = 100_000_000n; // 0.1 SOL covers the setup about three times
const WAIT_MIN = Number(process.env.FUND_WAIT_MIN) > 0 ? Number(process.env.FUND_WAIT_MIN) : 60;
async function fund() {
  try {
    const sig = await rpc.requestAirdrop(owner.address, 1_000_000_000n, { commitment: 'confirmed' }).send();
    await confirm(sig, 'airdrop');
    setup.push({ what: 'devnet airdrop 1 SOL', signature: sig });
    return;
  } catch (e) {
    log('airdrop refused:', e?.message ?? e);
  }
  log(`FUND ${owner.address} with at least 0.1 devnet SOL at https://faucet.solana.com (waiting ${WAIT_MIN} minutes)`);
  const until = Date.now() + WAIT_MIN * 60_000;
  while (Date.now() < until) {
    let value = 0n;
    try {
      ({ value } = await rpc.getBalance(owner.address, { commitment: 'confirmed' }).send());
    } catch {
      // A failed poll is not fatal: the address must stay alive until funded.
      log('balance check failed, will retry');
    }
    if (value >= NEEDED) {
      const sigs = await rpc.getSignaturesForAddress(owner.address, { limit: 5 }).send();
      setup.push({ what: `funded with ${value} lamports`, signature: sigs[0]?.signature ?? null });
      log('funded', String(value));
      return;
    }
    await sleep(10_000);
  }
  throw new Error(`not funded within ${WAIT_MIN} minutes`);
}

await fund();
// The fee wallet starts above the rent-exempt minimum, as a real fee wallet would.
await send('fund fee wallet', [ix.transfer(feeWallet.address, 1_000_000n)]);

const accounts = [];
for (let i = 0; i < 4; i++) accounts.push(await makeAccount('empty'));
accounts.push(await makeAccount('empty', TOKEN22));
accounts.push(await makeAccount('nft'));
accounts.push(await makeAccount('frozen'));
accounts.push(await makeAccount('balance'));
log('accounts ready', accounts.length);

// ─── Signing for the app ───────────────────────────────────────────────────
const signed = [];

async function signOne(base64) {
  const tx = txDecoder.decode(b64in.encode(base64));
  const msg = msgDecoder.decode(tx.messageBytes);
  if (msg.staticAccounts[0] !== owner.address) throw new Error('fee payer is not the test wallet');
  // A blockhash that devnet knows is a devnet transaction.
  const valid = await rpc.isBlockhashValid(msg.lifetimeToken, { commitment: 'confirmed' }).send();
  if (!valid.value) throw new Error('blockhash is not a current devnet blockhash');
  const keys = msg.staticAccounts;
  const summary = msg.instructions.map((i) => ({
    program: keys[i.programAddressIndex],
    accounts: (i.accountIndices ?? []).map((k) => keys[k]),
    data: b64out.decode(i.data ?? new Uint8Array()),
  }));
  const out = await signTransaction([owner.keyPair], tx);
  const signature = b58.decode(out.signatures[owner.address]);
  signed.push({ signature, accountKeys: keys, instructions: summary });
  log('signed', signature, `${summary.length} instructions`);
  return b64out.decode(txEncoder.encode(out));
}

// ─── Checks after the run ──────────────────────────────────────────────────
async function verify() {
  const report = { owner: owner.address, feeWallet: feeWallet.address, transactions: [], untouched: [] };
  for (const s of signed) {
    const tx = await rpc
      .getTransaction(s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
      .send();
    if (!tx) {
      report.transactions.push({ signature: s.signature, found: false });
      continue;
    }
    const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
    const delta = (a) => {
      const i = keys.indexOf(a);
      return i < 0 ? 0n : BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
    };
    const parsed = tx.transaction.message.instructions.map((i) => ({ program: i.programId, type: i.parsed?.type ?? 'raw', info: i.parsed?.info ?? null }));
    const closes = parsed.filter((p) => p.type === 'closeAccount').map((p) => p.info.account);
    const feeTransfers = parsed.filter((p) => p.type === 'transfer' && p.info?.destination === feeWallet.address);
    report.transactions.push({
      signature: s.signature,
      found: true,
      err: tx.meta.err,
      slot: tx.slot,
      instructions: parsed.map((p) => p.type),
      closedAccounts: closes,
      feeTransferLamports: feeTransfers.map((f) => String(f.info.lamports)),
      feeInSameTransaction: closes.length > 0 && feeTransfers.length === 1,
      networkFeeLamports: String(tx.meta.fee),
      ownerDeltaLamports: String(delta(owner.address)),
      feeWalletDeltaLamports: String(delta(feeWallet.address)),
      touchesNft: accounts.filter((a) => a.kind === 'nft').some((a) => keys.includes(a.account) || keys.includes(a.mint)),
      touchesFrozen: accounts.filter((a) => a.kind === 'frozen').some((a) => keys.includes(a.account)),
    });
  }
  for (const a of accounts.filter((x) => x.kind !== 'empty')) {
    const { value } = await rpc.getAccountInfo(a.account, { encoding: 'jsonParsed', commitment: 'confirmed' }).send();
    const info = value?.data?.parsed?.info;
    report.untouched.push({ kind: a.kind, account: a.account, mint: a.mint, exists: value !== null, state: info?.state ?? null, amount: info?.tokenAmount?.amount ?? null });
  }
  for (const a of accounts.filter((x) => x.kind === 'empty')) {
    const { value } = await rpc.getAccountInfo(a.account, { commitment: 'confirmed' }).send();
    report.untouched.push({ kind: 'empty (should be closed)', account: a.account, exists: value !== null });
  }
  return report;
}

// ─── HTTP, localhost only ──────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => {
      s += d;
      if (s.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(s));
  });
}

const server = http.createServer(async (req, res) => {
  const reply = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(json(body));
  };
  try {
    if (req.method === 'GET' && req.url === '/address') return reply(200, { address: owner.address });
    if (req.method === 'POST' && req.url === '/sign') {
      const { transactions } = JSON.parse(await readBody(req));
      if (!Array.isArray(transactions) || transactions.length === 0 || transactions.length > 10) return reply(400, { error: 'bad request' });
      const out = [];
      for (const t of transactions) out.push(await signOne(t));
      return reply(200, { signed: out });
    }
    if (req.method === 'GET' && req.url === '/state') return reply(200, { owner: owner.address, feeWallet: feeWallet.address, setup, accounts, signed });
    if (req.method === 'GET' && req.url === '/verify') return reply(200, await verify());
    return reply(404, { error: 'not found' });
  } catch (e) {
    log('error', e?.message ?? e);
    return reply(500, { error: String(e?.message ?? e) });
  }
});
server.listen(PORT, '127.0.0.1', () => log(`READY http://127.0.0.1:${PORT} fee=${feeWallet.address}`));
