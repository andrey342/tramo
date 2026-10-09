# 012. NestJS 12 on CommonJS, TypeScript 6 and Jest

- Status: accepted
- Date: 2026-10-09

## Context and problem statement

NestJS 12 ships its packages as ESM only and scaffolds new projects as ESM with Vitest and oxlint.
TypeScript 7, the native compiler, is the latest release. The project uses Jest and relies on
typescript-eslint's type-aware rules. Which module format, compiler and test runner should it use?

## Decision drivers

- Decorator metadata (`emitDecoratorMetadata`) must keep working for Nest's dependency injection.
- Jest is the test runner; tests should depend on as few experimental loaders as possible.
- typescript-eslint, ts-jest and the Swagger CLI plugin need the TypeScript compiler API.

## Considered options

1. ESM project with Vitest and oxlint (the Nest 12 default).
2. CommonJS project consuming Nest's ESM packages through `require(esm)`, with Jest and ESLint.

## Decision outcome

Option 2.

- TypeScript 6.0. TypeScript 7 does not expose the stable compiler API that ts-jest,
  typescript-eslint (peer range `<6.1`) and `@nestjs/swagger` (`^6`) require.
- `"type": "commonjs"` with `module: nodenext`. Node 24 loads Nest's ESM packages through
  `require(esm)`, which the Nest 12 migration guide documents as a supported setup.
- Jest 30 with ts-jest. Jest supports `require(esm)` only on Node 24.9+ and needs the vm modules
  API, so the test scripts start Jest through `node --experimental-vm-modules`. `engines.node` is
  `>=24.9.0` for this reason.
- ESLint 10 flat config with typescript-eslint's strict type-checked preset.
  `eslint-plugin-import` does not support ESLint 10, so import rules come from
  `eslint-plugin-import-x`, its maintained fork with the same rule names.

### Consequences

- Good: Jest, ts-jest and type-aware linting work as documented; application code needs no
  ESM-specific changes (no `.js` suffixes on relative imports).
- Bad: the test runner relies on an experimental Node flag. If that API changes, the fallback is
  Vitest, which `@nestjs/testing` supports equally.
- Bad: moving to ESM later touches every relative import. The steps are mechanical and described
  in the Nest migration guide.
