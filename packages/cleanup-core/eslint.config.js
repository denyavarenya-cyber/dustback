import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/**/*.ts'],
    rules: {
      // The module is pure logic: no UI, no logging, no key material.
      'no-console': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'cleanup-core has no UI.' },
            { name: 'react-native', message: 'cleanup-core has no UI.' },
          ],
          patterns: [
            { group: ['@solana/keys', '@solana/signers'], message: 'cleanup-core never handles keys or signs.' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportSpecifier[imported.name=/^(generateKeyPair|createKeyPairFromBytes|createKeyPairSignerFromBytes|generateKeyPairSigner|signTransaction|partiallySignTransaction|signBytes|createSignerFromKeyPair)$/]",
          message: 'cleanup-core never handles keys or signs.',
        },
      ],
    },
  },
);
