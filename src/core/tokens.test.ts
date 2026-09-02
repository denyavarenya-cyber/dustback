import { tokenLabel } from '../format';
import { fetchTokenSymbols } from './tokens';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const UNKNOWN = 'Unknown1111111111111111111111111111111111111';

const OPTS = { minRequestIntervalMs: 0 };

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe('fetchTokenSymbols', () => {
  it('maps known mints and leaves unknown mints absent', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('query')).toBe(`${BONK},${UNKNOWN}`);
      return jsonResponse([{ id: BONK, symbol: 'Bonk' }]);
    }) as unknown as typeof fetch;

    const symbols = await fetchTokenSymbols([BONK, UNKNOWN], {
      ...OPTS,
      fetchImpl,
    });
    expect(symbols).toEqual({ [BONK]: 'Bonk' });
  });

  it('truncates absurdly long symbols', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse([{ id: BONK, symbol: 'X'.repeat(40) }])
    ) as unknown as typeof fetch;
    const symbols = await fetchTokenSymbols([BONK], { ...OPTS, fetchImpl });
    expect(symbols[BONK]).toHaveLength(12);
  });

  it('returns an empty map when the fetch fails', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await fetchTokenSymbols([BONK], { ...OPTS, fetchImpl })).toEqual(
      {}
    );
  });

  it('returns an empty map on a malformed response', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ not: 'an array' })
    ) as unknown as typeof fetch;
    expect(await fetchTokenSymbols([BONK], { ...OPTS, fetchImpl })).toEqual(
      {}
    );
  });
});

describe('tokenLabel', () => {
  it('uses the symbol when known', () => {
    expect(tokenLabel(BONK, { [BONK]: 'Bonk' })).toBe('Bonk');
  });

  it('falls back to the shortened mint when unknown or unavailable', () => {
    expect(tokenLabel(UNKNOWN, { [BONK]: 'Bonk' })).toBe('Unkn…1111');
    expect(tokenLabel(UNKNOWN, undefined)).toBe('Unkn…1111');
  });
});
