import { describe, expect, it } from 'vitest';
import { APPEAL_NOTE, canConfirm, NO_WARNINGS, reviewTokenCheck, type TokenReview } from '../src/index';
import { fixture } from './helpers';

// Recorded answers of the core API mock (poe-engine `npm run serve:mock`, contract v1.0.0).
const CLEAN = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
const PULL = 'Cq4SiFC3rpx9zTCx2e2nQbweAB3siEGH2eW2CHRdiZ2X';
const FAKE = 'BBF3FfGm2hV7mGaJtHyFz2Yg5DhVqQKQYV4N2iisyCtF';
const FEE = 'CKfatsPMUf8SkiURsDXs7eK6GWb4Jsd6UDbs7twMCWxo';

type Answer = Record<string, unknown> & { warnings: Record<string, unknown>[] };
const answer = (name: string): Answer => fixture<Answer>(`core-token-${name}.json`);

/** No verdict words anywhere in what the screen gets. */
function expectNoVerdict(review: TokenReview): void {
  const text = JSON.stringify(review).toLowerCase();
  for (const word of ['safe', 'unsafe', 'scam', 'trusted', 'verified', 'score', 'rug']) {
    expect(text).not.toMatch(new RegExp(`\\b${word}\\b`));
  }
}

describe('token check on the swap confirm screen', () => {
  it('a token with only a level 1 warning: facts first, the warning with its level, no gate', () => {
    const r = reviewTokenCheck(answer('clean'), CLEAN);
    expect(r.status).toBe('checked');
    expect(r.facts.slice(0, 5).map((f) => f.label)).toEqual(['Name and ticker', 'Token program', 'Supply', 'Mint authority', 'Freeze authority']);
    expect(r.facts[0]?.value).toBe('POPCAT (POPCAT)');
    expect(r.facts.find((f) => f.label === 'Mint authority')?.value).toBe('Revoked');
    expect(r.facts.find((f) => f.label === 'Supply')?.proofs[0]?.url).toBe(`https://explorer.solana.com/address/${CLEAN}`);
    expect(r.warnings.map((w) => [w.level, w.code])).toEqual([[1, 'fewLaunches']]);
    expect(r.warnings[0]?.levelLabel).toBe('Level 1, little history');
    expect(r.gate).toBeNull();
    expect(canConfirm(r, null)).toBe(true);
    expect(r.exampleNote).toBe('Example token, illustrative data. A recorded answer, not a live read.');
    expectNoVerdict(r);
  });

  it('a level 3 warning gates the button behind one tap on a line that names it', () => {
    const r = reviewTokenCheck(answer('liquidity-pull'), PULL);
    expect(r.warnings.map((w) => [w.level, w.code])).toEqual([
      [3, 'liquidityPull'],
      [2, 'topHoldersConcentrated'],
    ]);
    expect(r.gate).not.toBeNull();
    expect(r.gate?.level).toBe(3);
    expect(r.gate?.codes).toEqual(['liquidityPull']);
    expect(r.gate?.line).toContain('Level 3, high risk');
    expect(r.gate?.line).toContain("The creator removed a launch's liquidity within 72 hours of the launch.");
    expect(r.gate?.line).not.toContain('warning signs');
    expect(canConfirm(r, null)).toBe(false);
    expect(canConfirm(r, 'topHoldersConcentrated')).toBe(false);
    expect(canConfirm(r, r.gate?.key ?? '')).toBe(true);
    expect(r.facts.some((f) => f.label === 'Liquidity removed')).toBe(true);
    expectNoVerdict(r);
  });

  it('a fake official asset: the listed asset as a fact, a level 2 warning, no gate', () => {
    const r = reviewTokenCheck(answer('fake-official'), FAKE);
    const listed = r.facts.find((f) => f.label === 'Listed asset');
    expect(listed?.value).toBe('Uses the ticker of Tesla xStock (TSLAx)');
    expect(listed?.note).toContain('XsDo…HzoB');
    expect(r.warnings.map((w) => [w.level, w.code])).toEqual([[2, 'notOfficialMint']]);
    expect(r.gate).toBeNull();
    expectNoVerdict(r);
  });

  it('a transfer fee shows as a fact with both rates, two level 2 warnings, no gate', () => {
    const r = reviewTokenCheck(answer('transfer-fee'), FEE);
    expect(r.facts.find((f) => f.label === 'Transfer fee')?.value).toBe('4.2% now, 2.69% from a later epoch');
    expect(r.warnings.every((w) => w.level === 2)).toBe(true);
    expect(r.gate).toBeNull();
  });

  it('every warning can be appealed, by mail with its code, never through a link from the answer', () => {
    const a = answer('liquidity-pull');
    a.warnings = a.warnings.map((w) => ({ ...w, appealUrl: 'https://attacker.example/appeal' }));
    const r = reviewTokenCheck(a, PULL);
    expect(APPEAL_NOTE).toBe('The owner can appeal.');
    for (const w of r.warnings) {
      expect(w.appealUrl).toBe(`mailto:support@noventia.app?subject=${encodeURIComponent(`Appeal ${w.code} ${PULL}`)}`);
    }
  });

  it('a level 4 warning gates too, and several high warnings are named in one line', () => {
    const a = answer('liquidity-pull');
    a.warnings = [...a.warnings, { warningLevel: 4, code: 'confirmed_fraud_case', about: 'token', factIds: [], proofs: [], appealUrl: '' }];
    const r = reviewTokenCheck(a, PULL);
    expect(r.warnings[0]?.level).toBe(4);
    expect(r.gate?.level).toBe(4);
    expect(r.gate?.codes).toEqual(['confirmedFraudCase', 'liquidityPull']);
    expect(r.gate?.line).toContain('Level 4, confirmed fraud');
    expect(r.gate?.line).toContain('Level 3, high risk');
  });

  it('no warnings reads as "no rule raised a warning", never as a verdict', () => {
    const a = answer('clean');
    a.warnings = [];
    const r = reviewTokenCheck(a, CLEAN);
    expect(r.noWarnings).toBe(NO_WARNINGS);
    expect(r.gate).toBeNull();
    expectNoVerdict(r);
  });

  it('fails closed: no answer, a broken answer or an answer for another mint gates the button', () => {
    for (const bad of [null, 'oops', {}, { ...answer('clean'), warnings: 'none' }, answer('liquidity-pull')]) {
      const r = reviewTokenCheck(bad, CLEAN);
      expect(r.status).toBe('unavailable');
      expect(r.gate?.key).toBe('noCheck');
      expect(r.gate?.line).toMatch(/^Swap without the token check\./);
      expect(canConfirm(r, null)).toBe(false);
      expect(canConfirm(r, 'noCheck')).toBe(true);
    }
  });

  it('skips warnings with an unknown level instead of guessing one', () => {
    const a = answer('clean');
    a.warnings = [{ warningLevel: 7, code: 'x', proofs: [] }, { warningLevel: '3', code: 'y', proofs: [] }];
    const r = reviewTokenCheck(a, CLEAN);
    expect(r.warnings).toEqual([]);
    expect(r.gate).toBeNull();
  });

  it('chain text stays text: names are decoded once, capped, and links come only from valid ids', () => {
    const a = answer('clean');
    a.token = [
      ...(a.token as Record<string, unknown>[]).filter((f) => f.kind !== 'solana.tokenMetadata'),
      {
        kind: 'solana.tokenMetadata',
        value: { name: '&lt;img src=x onerror=alert(1)&gt;' + 'A'.repeat(100), symbol: 'POP&amp;CAT' },
        proofs: [{ kind: 'solana-account', address: 'javascript:alert(1)', slot: 1 }],
      },
    ];
    const r = reviewTokenCheck(a, CLEAN);
    const name = r.facts.find((f) => f.label === 'Name and ticker');
    expect(name?.value.startsWith('<img src=x onerror=alert(1)>')).toBe(true);
    expect(name?.value).toContain('(POP&CAT)');
    expect(name?.value.length).toBeLessThanOrEqual(64 + 1 + 11);
    expect(name?.proofs[0]?.url).toBeNull();
  });
});
