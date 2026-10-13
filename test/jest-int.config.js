const base = require('../jest.config');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  rootDir: '..',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '\\.int-spec\\.ts$',
  globalSetup: '<rootDir>/test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/test/setup/global-teardown.ts',
  testTimeout: 60_000,
  passWithNoTests: false,
  // The domain thresholds belong to the unit run; this run only feeds the global gate
  // (pnpm coverage:check).
  coverageThreshold: {},
};
