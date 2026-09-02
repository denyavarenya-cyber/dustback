import { jupiterFetch, PriceOptions } from './price';

const TOKEN_SEARCH_URL = 'https://lite-api.jup.ag/tokens/v2/search';
const MAX_MINTS_PER_REQUEST = 50;
const MAX_SYMBOL_LENGTH = 12;

/** mint -> symbol for known tokens; missing mints simply stay absent. */
export async function fetchTokenSymbols(
  mints: string[],
  opts: PriceOptions = {}
): Promise<Record<string, string>> {
  const symbols: Record<string, string> = {};
  const unique = [...new Set(mints)];
  for (let i = 0; i < unique.length; i += MAX_MINTS_PER_REQUEST) {
    const chunk = unique.slice(i, i + MAX_MINTS_PER_REQUEST);
    try {
      const res = await jupiterFetch(
        `${TOKEN_SEARCH_URL}?query=${chunk.join(',')}`,
        undefined,
        opts
      );
      if (!res.ok) continue;
      const tokens = await res.json();
      if (!Array.isArray(tokens)) continue;
      for (const token of tokens) {
        if (
          typeof token?.id === 'string' &&
          typeof token?.symbol === 'string' &&
          token.symbol.trim() !== ''
        ) {
          symbols[token.id] = token.symbol.trim().slice(0, MAX_SYMBOL_LENGTH);
        }
      }
    } catch {
      // chunk unresolved: rows fall back to shortened mints
    }
  }
  return symbols;
}
