// The core API token check, made ready for the swap confirm screen.
//
// Rules this file keeps: facts come first and each carries its proof; warnings
// carry their level, highest first, and every one can be appealed; there is
// never a score and never a "safe" verdict. A level 3 or 4 warning, or a check
// that did not load, puts a gate on the confirm button: one extra tap on a line
// that names the warning. Chain text is shown as text only, and a link is built
// only from a valid address or signature.
//
// Pure functions, no network. The answer is untrusted input: anything that does
// not have the expected shape is treated as a check that did not load.

import { isAddress } from '@solana/kit';

export type WarningLevel = 1 | 2 | 3 | 4;

/** The level from which a warning gates the confirm button. */
export const GATE_LEVEL = 3;

export const LEVEL_LABEL: Record<WarningLevel, string> = {
  1: 'Level 1, little history',
  2: 'Level 2, warning signs',
  3: 'Level 3, high risk',
  4: 'Level 4, confirmed fraud',
};

const WARNING_TEXT: Record<string, string> = {
  liquidityPull: "The creator removed a launch's liquidity within 72 hours of the launch.",
  firstDayDumps: 'The creator sold at least half of their own tokens within a day of launch, in two or more launches.',
  oneFirstDayDump: 'The creator sold at least half of their own tokens within a day of one launch.',
  movedOutFirstDay: 'The creator moved at least half of their own tokens to other wallets within a day of launch.',
  mintAuthority: 'Someone can still mint more of this token.',
  freezeAuthority: "Someone can freeze holders' tokens.",
  transferFee: 'A fee is taken on every transfer of this token.',
  permanentDelegate: "One address can move or burn anyone's tokens.",
  transferHook: 'A program runs on every transfer.',
  defaultFrozen: 'New token accounts start frozen.',
  topHoldersConcentrated: 'The 10 largest holders hold half of the supply or more.',
  notOfficialMint: 'It uses the ticker or name of a listed asset, under another mint.',
  fundingCluster: 'Several of the largest holders were funded from one source within a day.',
  youngToken: 'The token is less than 90 days old.',
  youngWallet: 'The wallet is less than 90 days old.',
  fewLaunches: 'Fewer than three token launches on record.',
};

export const APPEAL_NOTE = 'The owner can appeal.';
export const NO_WARNINGS = 'No rule raised a warning on the facts read.';

export interface ReviewProof {
  kind: 'Transaction' | 'Account';
  /** Shortened id to show. */
  text: string;
  /** Explorer link, or null when the id is not valid (then shown as text only). */
  url: string | null;
  slot: number | null;
}

export interface ReviewFact {
  label: string;
  value: string;
  note?: string;
  proofs: ReviewProof[];
}

export interface ReviewWarning {
  level: WarningLevel;
  levelLabel: string;
  text: string;
  about: string | null;
  code: string;
  proofs: ReviewProof[];
  /** Where an appeal goes. A mailto with the code until an appeal page exists. */
  appealUrl: string;
}

export interface ConfirmGate {
  /** What the tap acknowledges; pass it back to canConfirm. */
  key: string;
  /** The highest level among the gating warnings, or null when the check did not load. */
  level: WarningLevel | null;
  codes: string[];
  /** The line the user taps. It names the warning. */
  line: string;
}

export interface TokenReview {
  mint: string;
  status: 'checked' | 'unavailable';
  /** Why the check did not load, in plain words. Null when it did. */
  unavailableReason: string | null;
  /** "Example token, illustrative data." for mock and example answers; null for live ones. */
  exampleNote: string | null;
  readUpTo: string | null;
  facts: ReviewFact[];
  warnings: ReviewWarning[];
  /** Shown when no rule raised a warning. Never a verdict. */
  noWarnings: string | null;
  gate: ConfirmGate | null;
}

// ---------- small helpers, no Intl (Hermes on Android) ----------

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isMintAddress(v: unknown): v is string {
  return typeof v === 'string' && isAddress(v);
}

function isSignature(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 64 && v.length <= 90 && BASE58.test(v);
}

function short(s: string, keep = 4): string {
  return s.length <= keep * 2 + 1 ? s : `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function int(n: number): string {
  return Number.isSafeInteger(n) ? (n < 0 ? `-${group(String(-n))}` : group(String(n))) : 'unknown';
}

function count(n: number, one: string, many: string): string {
  return `${int(n)} ${n === 1 ? one : many}`;
}

function utcDate(v: unknown): Date | null {
  const d = typeof v === 'number' ? new Date(v * 1000) : typeof v === 'string' ? new Date(v) : null;
  return d === null || Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: unknown): string {
  const d = utcDate(v);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : 'unknown';
}

function formatDateTime(v: unknown): string {
  const d = utcDate(v);
  if (!d) return 'unknown';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(v)}, ${hh}:${mm} UTC`;
}

/** A raw integer amount with its decimals, exact, with thousands separators. */
function amount(raw: unknown, decimals: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9]{1,40}$/.test(raw)) return 'unknown';
  const d = typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? decimals : 0;
  const padded = raw.padStart(d + 1, '0');
  const whole = padded.slice(0, padded.length - d) || '0';
  const frac = d > 0 ? padded.slice(padded.length - d).replace(/0+$/, '') : '';
  return frac ? `${group(whole)}.${frac}` : group(whole);
}

/**
 * Names arrive HTML-escaped and cleaned of invisible characters by the core.
 * Undo only the five basic entities, cap the length, and keep it text.
 */
export function chainText(s: unknown, max = 64): string {
  if (typeof s !== 'string') return '';
  const t = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function proof(p: unknown): ReviewProof | null {
  if (!isRecord(p)) return null;
  if (p.kind === 'solana-tx') {
    const ok = isSignature(p.signature);
    return { kind: 'Transaction', text: short(String(p.signature)), url: ok ? `https://explorer.solana.com/tx/${p.signature}` : null, slot: null };
  }
  if (p.kind === 'solana-account') {
    const ok = isMintAddress(p.address);
    const slot = typeof p.slot === 'number' && Number.isSafeInteger(p.slot) ? p.slot : null;
    return { kind: 'Account', text: short(String(p.address)), url: ok ? `https://explorer.solana.com/address/${p.address}` : null, slot };
  }
  return null;
}

function proofs(v: unknown): ReviewProof[] {
  return Array.isArray(v) ? v.map(proof).filter((p): p is ReviewProof => p !== null) : [];
}

// ---------- warnings ----------

/** The API has used both camelCase and snake_case codes; read either. */
export function normalizeCode(code: string): string {
  return code.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function warningText(code: string): string {
  const known = WARNING_TEXT[normalizeCode(code)];
  return known ?? `A rule raised warning ${chainText(code, 40)}.`;
}

/** Until a page for appeals exists, an appeal goes to the support address with the code. */
export function appealUrl(code: string, mint: string): string {
  return `mailto:support@noventia.app?subject=${encodeURIComponent(`Appeal ${normalizeCode(code)} ${mint}`)}`;
}

function warnings(v: unknown, mint: string): ReviewWarning[] {
  if (!Array.isArray(v)) return [];
  const out: ReviewWarning[] = [];
  for (const w of v) {
    if (!isRecord(w) || typeof w.code !== 'string' || ![1, 2, 3, 4].includes(w.warningLevel as number)) continue;
    const level = w.warningLevel as WarningLevel;
    out.push({
      level,
      levelLabel: LEVEL_LABEL[level],
      text: warningText(w.code),
      about: w.about === 'creator' ? "About the creator's wallet" : w.about === 'token' ? 'About the token' : null,
      code: normalizeCode(w.code),
      proofs: proofs(w.proofs),
      appealUrl: appealUrl(w.code, mint),
    });
  }
  return out.sort((a, b) => b.level - a.level);
}

// ---------- facts ----------

function authority(v: unknown): string {
  return isMintAddress(v) ? `Held by ${short(v)}` : 'Revoked';
}

function bps(v: unknown): string | null {
  return isRecord(v) && typeof v.bps === 'number' ? `${(v.bps / 100).toString()}%` : null;
}

function mintRows(v: Record<string, unknown>, p: ReviewProof[]): ReviewFact[] {
  const rows: ReviewFact[] = [
    {
      label: 'Token program',
      value: v.tokenProgram === 'token-2022' ? 'Token-2022' : 'SPL Token',
      ...(typeof v.decimals === 'number' ? { note: `${int(v.decimals)} decimals` } : {}),
      proofs: p,
    },
    { label: 'Supply', value: amount(v.supplyRaw, v.decimals), proofs: p },
    { label: 'Mint authority', value: authority(v.mintAuthority), proofs: p },
    { label: 'Freeze authority', value: authority(v.freezeAuthority), proofs: p },
  ];
  if (isRecord(v.transferFee)) {
    const older = bps(v.transferFee.older);
    const newer = bps(v.transferFee.newer);
    const parts = [older ? `${older} now` : null, newer && newer !== older ? `${newer} from a later epoch` : null].filter(Boolean);
    rows.push({ label: 'Transfer fee', value: parts.join(', ') || 'Set', proofs: p });
  }
  if (isMintAddress(v.permanentDelegate)) rows.push({ label: 'Permanent delegate', value: short(v.permanentDelegate), proofs: p });
  if (isMintAddress(v.transferHookProgram)) rows.push({ label: 'Transfer hook program', value: short(v.transferHookProgram), proofs: p });
  if (v.defaultAccountState === 'frozen') rows.push({ label: 'New accounts', value: 'Start frozen', proofs: p });
  return rows;
}

function tokenFactRows(f: Record<string, unknown>): ReviewFact[] {
  const v = isRecord(f.value) ? f.value : {};
  const p = proofs(f.proofs);
  switch (f.kind) {
    case 'solana.mintState':
      return mintRows(v, p);
    case 'solana.tokenMetadata': {
      const name = chainText(v.name);
      const symbol = chainText(v.symbol, 16);
      return [{ label: 'Name and ticker', value: [name, symbol ? `(${symbol})` : ''].filter(Boolean).join(' ') || 'None', proofs: p }];
    }
    case 'solana.tokenFirstTransaction':
      return [{ label: 'First transaction', value: formatDate(v.blockTime), proofs: p }];
    case 'solana.holderConcentration': {
      const pct = typeof v.topSharePct === 'number' ? `${v.topSharePct.toFixed(2)}% of supply` : 'unknown';
      return [{ label: 'Held by the 10 largest holders', value: pct, note: 'Pools, known exchange wallets and burn addresses left out.', proofs: p }];
    }
    default:
      return [];
  }
}

const FACT_ORDER = ['solana.tokenMetadata', 'solana.mintState', 'solana.tokenFirstTransaction', 'solana.holderConcentration'];

function cardRow(label: string, n: unknown): ReviewFact | null {
  if (!isRecord(n) || typeof n.value !== 'number') return null;
  return { label, value: int(n.value), proofs: proofs(n.proofs) };
}

function launchRows(launch: unknown[]): ReviewFact[] {
  const created = launch.find((f) => isRecord(f) && f.kind === 'solana.tokenCreated') as Record<string, unknown> | undefined;
  const createdAt = created && isRecord(created.value) ? created.value.blockTime : null;
  const rows: ReviewFact[] = [];
  for (const f of launch) {
    if (!isRecord(f)) continue;
    const v = isRecord(f.value) ? f.value : {};
    const t = typeof v.blockTime === 'number' ? v.blockTime : null;
    if (f.kind === 'solana.tokenCreated') rows.push({ label: 'Launched', value: formatDate(t), proofs: proofs(f.proofs) });
    if (f.kind === 'solana.liquidityRemoved') {
      const secs = typeof createdAt === 'number' && t !== null ? Math.max(0, t - createdAt) : null;
      const note =
        secs === null ? undefined : secs < 3600 ? `${count(Math.round(secs / 60), 'minute', 'minutes')} after launch.` : `${count(Math.round(secs / 3600), 'hour', 'hours')} after launch.`;
      rows.push({ label: 'Liquidity removed', value: formatDate(t), ...(note ? { note } : {}), proofs: proofs(f.proofs) });
    }
  }
  return rows;
}

function facts(r: Record<string, unknown>): ReviewFact[] {
  const out: ReviewFact[] = [];
  const token = (Array.isArray(r.token) ? r.token : []).filter(isRecord);
  token.sort((a, b) => FACT_ORDER.indexOf(String(a.kind)) - FACT_ORDER.indexOf(String(b.kind)));
  for (const f of token) out.push(...tokenFactRows(f));

  if (isRecord(r.fundingClusters) && r.fundingClusters.status !== 'checked') {
    const why = r.fundingClusters.reason === 'needs_paid_plan' ? 'Needs a paid data plan; switched on later.' : 'Not available for this token.';
    out.push({ label: 'Holders funded from one source', value: 'Not checked', note: why, proofs: [] });
  }

  if (isRecord(r.official)) {
    const o = r.official;
    out.push({
      label: 'Listed asset',
      value: o.isThisMint
        ? `This is the official ${chainText(o.ticker, 16)} mint`
        : `Uses the ${o.matchedOn === 'name' ? 'name' : 'ticker'} of ${chainText(o.name)} (${chainText(o.ticker, 16)})`,
      note: o.isThisMint
        ? `Listed by ${chainText(o.issuer)}.`
        : `The official mint is ${isMintAddress(o.mint) ? short(o.mint) : 'listed by the issuer'}, listed by ${chainText(o.issuer)}.`,
      proofs: [],
    });
    for (const p of Array.isArray(r.issuerPowers) ? r.issuerPowers : []) {
      if (isRecord(p)) out.push({ label: 'Issuer power', value: chainText(p.text, 160), proofs: proofs(p.proofs) });
    }
  }

  if (isMintAddress(r.creator)) {
    const card = isRecord(r.creatorCard) ? r.creatorCard : null;
    out.push({
      label: 'Creator',
      value: short(r.creator, 6),
      ...(card && card.onSolanaSince ? { note: `On Solana since ${formatDate(card.onSolanaSince)}.` } : {}),
      proofs: [{ kind: 'Account', text: short(r.creator), url: `https://explorer.solana.com/address/${r.creator}`, slot: null }],
    });
  } else {
    out.push({ label: 'Creator', value: 'Not proven', note: 'No wallet could be shown to have signed the launch.', proofs: [] });
  }
  if (isRecord(r.creatorCard)) {
    const c = r.creatorCard;
    for (const row of [
      cardRow('Tokens launched', c.tokensLaunched),
      cardRow('Liquidity removed within 72 hours of a launch', c.liquidityPulls),
      cardRow('Sold half of their own tokens on launch day', c.firstDayDumps),
      cardRow('Moved half of their own tokens out on launch day', c.movedOutFirstDay),
    ]) {
      if (row) out.push(row);
    }
  }
  out.push(...launchRows(Array.isArray(r.launch) ? r.launch : []));
  return out;
}

// ---------- the review and its gate ----------

function gateFor(list: ReviewWarning[]): ConfirmGate | null {
  const high = list.filter((w) => w.level >= GATE_LEVEL);
  if (high.length === 0) return null;
  const top = high[0] as ReviewWarning;
  const named = high.map((w) => `${w.levelLabel}: ${w.text}`).join(' ');
  return {
    key: high.map((w) => w.code).join('+'),
    level: top.level,
    codes: high.map((w) => w.code),
    line: `I read the warning. ${named}`,
  };
}

/** A check that did not load gates the button too: the user swaps without it only on purpose. */
export function unavailableReview(mint: string, reason: string): TokenReview {
  return {
    mint,
    status: 'unavailable',
    unavailableReason: reason,
    exampleNote: null,
    readUpTo: null,
    facts: [],
    warnings: [],
    noWarnings: null,
    gate: { key: 'noCheck', level: null, codes: ['noCheck'], line: `Swap without the token check. ${reason}` },
  };
}

/**
 * Turns a core API answer for GET /v1/check/token/{mint} into what the swap
 * confirm screen shows. `mint` is the token the user receives; an answer for
 * another mint is refused.
 */
export function reviewTokenCheck(answer: unknown, mint: string): TokenReview {
  if (!isRecord(answer) || !isRecord(answer.meta) || answer.mint !== mint || !Array.isArray(answer.warnings) || !Array.isArray(answer.token)) {
    return unavailableReview(mint, 'The check answer was not readable.');
  }
  const meta = answer.meta;
  const list = warnings(answer.warnings, mint);
  const example = meta.example === true || meta.mock === true;
  return {
    mint,
    status: 'checked',
    unavailableReason: null,
    exampleNote: example ? `Example token, illustrative data.${meta.mock === true ? ' A recorded answer, not a live read.' : ''}` : null,
    readUpTo: typeof meta.asOf === 'string' ? `Read up to ${formatDateTime(meta.asOf)}` : null,
    facts: facts(answer),
    warnings: list,
    noWarnings: list.length === 0 ? NO_WARNINGS : null,
    gate: gateFor(list),
  };
}

/** The confirm button works when there is no gate, or when the gate's line was tapped. */
export function canConfirm(review: TokenReview, acknowledged: string | null): boolean {
  return review.gate === null || acknowledged === review.gate.key;
}
