// Turns what `typeorm migration:generate` wrote into a migration in the repo's shape, or writes an
// empty one to fill by hand.
//   tsx shape-migration.ts generated <generated file> <module> <verb-noun>
//   tsx shape-migration.ts new <module> <verb-noun>
//
// Entities here map columns only. CHECK constraints, indexes, foreign keys and defaults are
// written by hand in migrations (.claude/rules/migrations.md), so the generator always proposes
// to drop them. Those statements are discarded; what remains are table and column changes.
import { globSync, readFileSync, rmSync } from 'node:fs';

import { ChangeSet, exists, fail, migrationStamp, pascal, ROOT, tidy } from '../../../lib/scaffold';

const [mode, ...rest] = process.argv.slice(2);

// PostgreSQL reserved key words (SQL Key Words appendix, column 'reserved'); as identifiers they
// must stay quoted.
const RESERVED = new Set(
  (
    'all analyse analyze and any array as asc asymmetric authorization binary both case cast check ' +
    'collate collation column concurrently constraint create cross current_catalog current_date ' +
    'current_role current_schema current_time current_timestamp current_user default deferrable ' +
    'desc distinct do else end except false fetch for foreign freeze from full grant group having ' +
    'ilike in initially inner intersect into is isnull join lateral leading left like limit ' +
    'localtime localtimestamp natural not notnull null offset on only or order outer overlaps ' +
    'placing primary references returning right select session_user similar some symmetric ' +
    'system_user table tablesample then to trailing true union unique user using variadic verbose ' +
    'when where window with'
  ).split(' '),
);

// Statements about objects the entities do not describe.
const NOT_MODELLED = [
  /\bDROP CONSTRAINT\b/i,
  /\bADD CONSTRAINT\b/i,
  /\b(CREATE|DROP)( UNIQUE)? INDEX\b/i,
  /\bALTER COLUMN "?\w+"? (SET|DROP) DEFAULT\b/i,
];

function statements(source: string, method: 'up' | 'down'): string[] {
  // up() runs until down() starts; down() until the end of the class.
  const upStart = source.indexOf('async up(');
  const downStart = source.indexOf('async down(');
  const body = method === 'up' ? source.slice(upStart, downStart) : source.slice(downStart);
  return (
    [...body.matchAll(/queryRunner\.query\(\s*`([\s\S]*?)`/g)]
      .map((match) => (match[1] ?? '').replace(/\s+/g, ' ').trim())
      .filter((sql) => !NOT_MODELLED.some((pattern) => pattern.test(sql)))
      // Plain lower-case identifiers do not need quotes; the repo writes them bare. Reserved words
      // (a column called "order" or "user") keep them.
      .map((sql) =>
        sql.replace(/"([a-z_][a-z0-9_]*)"/g, (quoted, name: string) =>
          RESERVED.has(name) ? quoted : name,
        ),
      )
  );
}

function render(className: string, up: string[], down: string[]): string {
  // An empty method is a placeholder to fill in; it compiles and lints, and does nothing.
  const method = (name: 'up' | 'down', sqls: string[], todo: string): string =>
    sqls.length > 0
      ? `  async ${name}(queryRunner: QueryRunner): Promise<void> {
${sqls.map((sql) => `    await queryRunner.query(\`${sql}\`);`).join('\n')}
  }`
      : `  async ${name}(_queryRunner: QueryRunner): Promise<void> {
    // ${todo}
  }`;
  return `import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class ${className} implements MigrationInterface {
  name = '${className}';

${method('up', up, 'Schema-qualified SQL; named constraints and indexes; CHECKs for enums and cents.')}

${method('down', down, 'Undo exactly what up() did, in reverse order.')}
}
`;
}

function target(module: string, description: string): { path: string; className: string } {
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(description)) {
    fail('description must be <verb>-<noun> in kebab-case, e.g. add-program-price-cap');
  }
  if (!exists(`src/modules/${module}`) && module !== 'shared') {
    fail(`no module ${module}`);
  }
  const base =
    module === 'shared'
      ? 'src/shared/infrastructure/database'
      : `src/modules/${module}/infrastructure/persistence`;
  // TypeORM orders migrations by the class timestamp, so two migrations never share a minute.
  const taken = new Set(
    globSync('src/**/migrations/*.ts', { cwd: ROOT }).map(
      (file) => /(\d{12})-[^/\\]+\.ts$/.exec(file)?.[1],
    ),
  );
  let at = new Date();
  let stamp = migrationStamp(at);
  while (taken.has(stamp.file)) {
    at = new Date(at.getTime() + 60_000);
    stamp = migrationStamp(at);
  }
  return {
    path: `${base}/migrations/${stamp.file}-${description}.ts`,
    className: `${pascal(description)}${String(stamp.ms)}`,
  };
}

const changes = new ChangeSet();
if (mode === 'generated') {
  const [generated, module, description] = rest;
  if (!generated || !module || !description) fail('usage: generated <file> <module> <verb-noun>');
  const source = readFileSync(generated, 'utf8');
  rmSync(generated);
  const up = statements(source, 'up');
  const down = statements(source, 'down');
  const { path, className } = target(module, description);
  changes.create(path, render(className, up, down));
  if (up.length === 0) {
    console.log(
      'No table or column changes between the entities and the database; the file is empty to fill by hand.',
    );
  }
} else if (mode === 'new') {
  const [module, description] = rest;
  if (!module || !description) fail('usage: new <module> <verb-noun>');
  const { path, className } = target(module, description);
  changes.create(path, render(className, [], []));
} else {
  fail(
    'usage: shape-migration.ts generated <file> <module> <verb-noun> | new <module> <verb-noun>',
  );
}
tidy(changes.apply(false));
