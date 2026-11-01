// Screenshot run without devnet SOL. Not part of the app.
//
// A local JSON-RPC stand-in that answers like devnet for one wallet, with the
// same account mix the funded devnet run creates, plus the test wallet bridge
// API. The key is in memory and non-extractable; signed transactions go to
// this stand-in only, never to any cluster.
import http from 'node:http';
import { createHash } from 'node:crypto';
import {
  generateKeyPairSigner,
  getBase58Decoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  signTransaction,
} from '@solana/kit';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const b58 = getBase58Decoder();
const b64in = getBase64Encoder();
const b64out = getBase64Decoder();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fake = (label) => b58.decode(createHash('sha256').update(`noventia-e2e:${label}`).digest());

const owner = await generateKeyPairSigner();
const feeWallet = fake('fee-wallet');
log('owner', owner.address, 'extractable:', owner.keyPair.privateKey.extractable);

function entry(label, { program = TOKEN, amount = 0n, decimals = 6, state = 'initialized' } = {}) {
  const t22 = program === TOKEN22;
  const lamports = t22 ? 2_074_080 : 2_039_280;
  const info = {
    isNative: false,
    mint: fake(`mint:${label}`),
    owner: owner.address,
    state,
    tokenAmount: { amount: String(amount), decimals, uiAmount: Number(amount) / 10 ** decimals, uiAmountString: String(Number(amount) / 10 ** decimals) },
  };
  if (t22) info.extensions = [{ extension: 'immutableOwner' }];
  return {
    pubkey: fake(`account:${label}`),
    account: {
      data: { parsed: { info, type: 'account' }, program: t22 ? 'spl-token-2022' : 'spl-token', space: t22 ? 170 : 165 },
      executable: false,
      lamports,
      owner: program,
      rentEpoch: 18446744073709552000,
      space: t22 ? 170 : 165,
    },
  };
}

const entries = [
  entry('empty-1'),
  entry('empty-2'),
  entry('empty-3'),
  entry('empty-4'),
  entry('empty-t22', { program: TOKEN22 }),
  entry('nft', { amount: 1n, decimals: 0 }),
  entry('frozen', { state: 'frozen' }),
  entry('balance', { amount: 1_000_000_000n }),
];
const closed = new Set();
const sent = new Map();
let slot = 420_000_000;
const BLOCKHASH = fake('blockhash');

function rpcAnswer(method, params) {
  switch (method) {
    case 'getGenesisHash':
      return DEVNET_GENESIS;
    case 'getLatestBlockhash':
      return { context: { slot }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 400_000_150 } };
    case 'getTokenAccountsByOwner': {
      const program = params[1]?.programId;
      return { context: { slot }, value: entries.filter((e) => e.account.owner === program && !closed.has(e.pubkey)) };
    }
    case 'simulateTransaction': {
      const watch = params[1]?.accounts?.addresses ?? null;
      return {
        context: { slot },
        value: { err: null, logs: ['Program log: stand-in'], accounts: watch ? watch.map(() => null) : null, unitsConsumed: 24_000, returnData: null },
      };
    }
    case 'sendTransaction': {
      const tx = getTransactionDecoder().decode(b64in.encode(params[0]));
      const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
      const signature = b58.decode(tx.signatures[owner.address]);
      sent.set(signature, msg);
      // Close what the transaction closes, so a new scan shows the result.
      for (const ix of msg.instructions) {
        const program = msg.staticAccounts[ix.programAddressIndex];
        if ((program === TOKEN || program === TOKEN22) && ix.data?.[0] === 9) closed.add(msg.staticAccounts[ix.accountIndices[0]]);
      }
      slot += 3;
      log('sent', signature, `${msg.instructions.length} instructions`);
      return signature;
    }
    case 'getSignatureStatuses':
      return { context: { slot }, value: params[0].map((s) => (sent.has(s) ? { slot, confirmations: null, err: null, confirmationStatus: 'confirmed' } : null)) };
    default:
      throw new Error(`stand-in has no answer for ${method}`);
  }
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
function body(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => (s += d));
    req.on('end', () => resolve(s));
  });
}

http
  .createServer(async (req, res) => {
    const r = JSON.parse(await body(req));
    try {
      json(res, 200, { jsonrpc: '2.0', id: r.id, result: rpcAnswer(r.method, r.params ?? []) });
    } catch (e) {
      log('rpc error', r.method, e.message);
      json(res, 200, { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: e.message } });
    }
  })
  .listen(8798, '127.0.0.1', () => log('rpc stand-in on 8798'));

http
  .createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/address') return json(res, 200, { address: owner.address });
    if (req.method === 'POST' && req.url === '/sign') {
      const { transactions } = JSON.parse(await body(req));
      const out = [];
      for (const t of transactions) {
        const tx = getTransactionDecoder().decode(b64in.encode(t));
        const signedTx = await signTransaction([owner.keyPair], tx);
        out.push(b64out.decode(getTransactionEncoder().encode(signedTx)));
      }
      log('signed', out.length);
      return json(res, 200, { signed: out });
    }
    if (req.method === 'GET' && req.url === '/state') return json(res, 200, { owner: owner.address, feeWallet, sent: [...sent.keys()] });
    return json(res, 404, { error: 'not found' });
  })
  .listen(8799, '127.0.0.1', () => log(`READY wallet on 8799 fee=${feeWallet}`));
