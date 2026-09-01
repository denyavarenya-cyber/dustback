/** Pure TS unit tests only — no react-native rendering, so no jest-expo preset. */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
