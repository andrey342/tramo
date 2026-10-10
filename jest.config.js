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
  // Domain code is covered by unit tests alone, to 95 %. Each module's domain folder is
  // listed so the threshold applies to it as a whole. The global 80 % target spans unit,
  // integration and e2e runs, so a unit run alone cannot enforce it.
  coverageThreshold: {
    './src/shared/domain/': { statements: 95, branches: 90, functions: 85, lines: 95 },
    './src/modules/iam/domain/': { statements: 95, branches: 90, functions: 85, lines: 95 },
  },
  passWithNoTests: true,
};
