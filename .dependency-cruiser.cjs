// Hexagonal dependency rules (see docs/adr). `pnpm arch:check` must report zero violations.
// Matched against resolved paths, so packages are identified by their node_modules folder.
const pkg = (names) => `node_modules/(${names.join('|')})/`;
const FRAMEWORKS = pkg([
  '@nestjs',
  '@nestjs-cls',
  'typeorm',
  'pg',
  'ioredis',
  'bullmq',
  'express',
  'class-validator',
  'class-transformer',
  'nestjs-cls',
  'nestjs-pino',
]);
const PERSISTENCE = pkg(['typeorm', 'pg', 'ioredis', 'bullmq']);

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-framework-free',
      comment: 'Domain code must not depend on Nest, the ORM or any other infrastructure library.',
      severity: 'error',
      from: { path: '^src/(modules/[^/]+|shared)/domain/' },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer'], path: FRAMEWORKS },
    },
    {
      name: 'domain-depends-on-nothing-outward',
      comment:
        'Domain must not import application or infrastructure code, of its own module or shared.',
      severity: 'error',
      from: { path: '^src/(modules/[^/]+|shared)/domain/' },
      to: { path: '^src/(modules/[^/]+|shared)/(application|infrastructure)/' },
    },
    {
      name: 'application-does-not-touch-infrastructure',
      comment:
        'Use cases talk to ports; adapters live in infrastructure and are wired by the module.',
      severity: 'error',
      from: { path: '^src/(modules/[^/]+|shared)/application/' },
      to: { path: '^src/(modules/[^/]+|shared)/infrastructure/' },
    },
    {
      name: 'application-is-orm-free',
      comment: 'Persistence details stay behind repository ports.',
      severity: 'error',
      from: { path: '^src/(modules/[^/]+|shared)/application/' },
      to: { path: PERSISTENCE },
    },
    {
      name: 'modules-talk-through-public-api',
      comment:
        'A module may only import another module through its application/dto facade or its domain events.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: [
          '^src/modules/$1/',
          '^src/modules/[^/]+/application/dto/',
          '^src/modules/[^/]+/domain/events/',
        ],
      },
    },
    {
      name: 'shared-does-not-know-modules',
      severity: 'error',
      from: { path: '^src/shared/' },
      to: { path: '^src/modules/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-test-code-in-production',
      severity: 'error',
      from: { path: '^src/', pathNot: '\.(spec|int-spec)\.ts$' },
      to: { path: ['^test/', '\.(spec|int-spec)\.ts$'] },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['^dist/', '^coverage/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['require', 'import', 'node', 'default', 'types'],
      mainFields: ['main', 'types'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
