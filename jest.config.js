const { readdirSync } = require('node:fs');
const { join } = require('node:path');

// Domain code is covered by unit tests alone, to 95 %. The threshold applies to each domain folder
// as a whole, from the moment the folder has specs, so a freshly scaffolded module does not fail
// the run before its first aggregate exists. The global 80 % target spans unit, integration and
// e2e runs, so a unit run alone cannot enforce it.
const DOMAIN_THRESHOLD = { statements: 95, branches: 90, functions: 85, lines: 95 };

function hasSpecs(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true }).some(
    (entry) => entry.isFile() && entry.name.endsWith('.spec.ts'),
  );
}

const domainFolders = [
  'src/shared/domain',
  ...readdirSync('src/modules').map((module) => join('src/modules', module, 'domain')),
].filter((dir) => {
  try {
    return hasSpecs(dir);
  } catch {
    return false;
  }
});

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: {
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.int-spec.ts',
    '!src/main.*.ts',
    '!src/**/migrations/*.ts',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: Object.fromEntries(
    domainFolders.map((dir) => [`./${dir.replace(/\\/g, '/')}/`, DOMAIN_THRESHOLD]),
  ),
  passWithNoTests: true,
};
