// Tests run on recorded fixtures only. Any real network call fails loudly.
globalThis.fetch = (() => {
  throw new Error('network access is disabled in tests');
}) as typeof fetch;
