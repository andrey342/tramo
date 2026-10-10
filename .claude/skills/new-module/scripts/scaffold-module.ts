// Scaffolds a bounded context shaped like `iam`, the reference module, and registers it where the
// rest of the codebase expects to find it.
//   pnpm scaffold:module <name> --responsibility "<one line>" [--dry-run]
import {
  addImport,
  appendToArray,
  assertKebab,
  ChangeSet,
  exists,
  fail,
  insertAfterLast,
  migrationStamp,
  parseArgs,
  pascal,
  run,
  snake,
  tidy,
} from '../../../lib/scaffold';

const { positional, flags, options } = parseArgs(process.argv.slice(2));
const name = positional[0] ?? fail('usage: scaffold-module <name> --responsibility "<one line>"');
assertKebab(name, 'module name');
const responsibility =
  options.get('responsibility') ?? fail('--responsibility "<one line>" is required (README map).');
const dryRun = flags.has('dry-run');

const Name = pascal(name);
const schema = snake(name);
const base = `src/modules/${name}`;
if (exists(base)) {
  fail(`${base} already exists.`);
}
const stamp = migrationStamp();
const changes = new ChangeSet();

changes.create(
  `${base}/domain/events/${name}-events.ts`,
  `// Published contract of the ${name} module: other modules subscribe to these by event type and
// read the payload, never the aggregates. Payloads are type aliases (not interfaces) so they
// satisfy the JSON payload constraint of DomainEvent.
export const ${Name}Events = {} as const;
`,
);

changes.create(`${base}/domain/index.ts`, `export * from './events/${name}-events';\n`);

changes.create(
  `${base}/${name}.module.ts`,
  `import { Module } from '@nestjs/common';

// Use cases, persistence and adapters of the ${name} context. Shared by both processes; the HTTP
// surface lives in ${Name}HttpModule, which only the api imports.
@Module({
  providers: [],
  exports: [],
})
export class ${Name}Module {}
`,
);

changes.create(
  `${base}/${name}-http.module.ts`,
  `import { Module } from '@nestjs/common';

import { ${Name}Module } from './${name}.module';

@Module({
  imports: [${Name}Module],
  controllers: [],
})
export class ${Name}HttpModule {}
`,
);

changes.create(
  `${base}/infrastructure/persistence/migrations/${stamp.file}-create-${name}-schema.ts`,
  `import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class Create${Name}Schema${String(stamp.ms)} implements MigrationInterface {
  name = 'Create${Name}Schema${String(stamp.ms)}';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`CREATE SCHEMA IF NOT EXISTS ${schema}\`);
  }

  // Without CASCADE: reverting fails loudly if a later migration left tables behind.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(\`DROP SCHEMA IF EXISTS ${schema}\`);
  }
}
`,
);

changes.edit('src/app.module.ts', (content) =>
  appendToArray(
    addImport(content, `import { ${Name}HttpModule } from '@modules/${name}/${name}-http.module';`),
    /imports: \[/,
    `${Name}HttpModule`,
    'src/app.module.ts',
  ),
);

changes.edit('src/worker.module.ts', (content) =>
  appendToArray(
    addImport(content, `import { ${Name}Module } from '@modules/${name}/${name}.module';`),
    /imports: \[/,
    `${Name}Module`,
    'src/worker.module.ts',
  ),
);

// One events queue per module (`events.<name>`), created by QueuesModule from this list.
changes.edit('src/shared/infrastructure/queues/queue-names.ts', (content) =>
  content.includes(`'${name}'`)
    ? content
    : appendToArray(content, /export const MODULES = \[/, `'${name}'`, 'queue-names.ts'),
);

changes.edit('docker/postgres/init.sql', (content) =>
  content.includes(`SCHEMA IF NOT EXISTS ${schema};`)
    ? content
    : insertAfterLast(
        content,
        /^CREATE SCHEMA IF NOT EXISTS \w+;$/gm,
        `CREATE SCHEMA IF NOT EXISTS ${schema};\n`,
        'init.sql',
      ),
);

changes.edit('README.md', (content) =>
  insertAfterLast(
    content,
    /^\| `[a-z-]+` +\|.*\|$/gm,
    `| \`${name}\` | ${responsibility} | |\n`,
    'README.md (module map)',
  ),
);

const touched = changes.apply(dryRun);
if (dryRun) {
  process.exit(0);
}
tidy(touched);
run('pnpm', ['arch:check']);
console.log(`
${Name} scaffolded and arch:check is clean. Next:
  - model the first aggregate in ${base}/domain with specs
    (the domain coverage threshold applies once the folder has specs);
  - add use cases: pnpm scaffold:use-case ${name} <Name> --command|--query;
  - an existing compose volume: apply docker/postgres/diagnostics.sql again
    so tramo_ro can read the ${schema} schema.`);
