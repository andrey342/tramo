// Scaffolds a command or query with its handler, DTO and spec, and registers the handler in the
// module. Shapes follow iam (e.g. RevokeApiKeyCommand, ListApiKeysQuery).
//   pnpm scaffold:use-case <module> <Name> --command|--query [--repository <Aggregate>] [--dry-run]
// With --repository the handler loads that aggregate by id (and a command saves it back), and the
// spec runs against the in-memory repository from test/fakes/<module>.ts.
import {
  addImport,
  appendToArray,
  assertKebab,
  assertPascal,
  camel,
  ChangeSet,
  constantCase,
  exists,
  fail,
  insertAfterLast,
  kebabFromPascal,
  parseArgs,
  read,
  tidy,
} from '../../../lib/scaffold';

const USAGE =
  'usage: scaffold-use-case <module> <Name> --command|--query [--repository <Aggregate>]';
const { positional, flags, options } = parseArgs(process.argv.slice(2));
const [module, Name] = positional;
if (!module || !Name) {
  fail(USAGE);
}
assertKebab(module, 'module');
assertPascal(Name, 'use case name');
const kind = flags.has('command') ? 'command' : flags.has('query') ? 'query' : fail(USAGE);
const Aggregate = options.get('repository');
if (Aggregate) {
  assertPascal(Aggregate, 'aggregate');
}
const dryRun = flags.has('dry-run');

const base = `src/modules/${module}`;
const moduleFile = `${base}/${module}.module.ts`;
if (!exists(moduleFile)) {
  fail(`${moduleFile} not found; scaffold the module first (pnpm scaffold:module ${module}).`);
}
const file = kebabFromPascal(Name);
const Kind = kind === 'command' ? 'Command' : 'Query';
const folder = kind === 'command' ? 'commands' : 'queries';
const path = `${base}/application/${folder}/${file}.${kind}.ts`;
const specPath = `${base}/application/${folder}/${file}.${kind}.spec.ts`;
const dtoPath = `${base}/application/dto/${file}.dto.ts`;
const fakesPath = `test/fakes/${module}.ts`;

const repo = Aggregate ? repositoryNames(Aggregate) : undefined;
if (repo && !read(`${base}/domain/index.ts`).includes('ports/')) {
  // The repository port must exist before a use case can depend on it.
  fail(`${base}/domain does not export repository ports yet; add ${repo.token} first.`);
}

const changes = new ChangeSet();

if (kind === 'query') {
  changes.create(
    dtoPath,
    `export interface ${Name}Dto {
  readonly id: string;
}
`,
  );
}

changes.create(path, kind === 'command' ? commandTemplate() : queryTemplate());
changes.create(specPath, specTemplate());

if (repo && Aggregate) {
  if (!exists(fakesPath)) {
    changes.create(fakesPath, `import { InMemoryRepository } from './shared';\n`);
  }
  // A second import from the same module is merged by eslint --fix in tidy().
  changes.edit(fakesPath, (content) =>
    // Prettier may break the declaration after the name, so match a word boundary, not a space.
    new RegExp(`class InMemory${repo.type}\\b`).test(content)
      ? content
      : `${addImport(
          addImport(content, `import { InMemoryRepository } from './shared';`),
          `import { type ${Aggregate}, type ${repo.type} } from '../../src/modules/${module}/domain';`,
        )}
// Queries beyond findById/save are implemented here as the port grows.
export class InMemory${repo.type}
  extends InMemoryRepository<${Aggregate}>
  implements ${repo.type} {}
`,
  );
}

// Handlers come first in providers, as in iam; factory providers follow them.
changes.edit(moduleFile, (content) => {
  const withImport = addImport(
    content,
    `import { ${Name}Handler } from './application/${folder}/${file}.${kind}';`,
  );
  return /^ {4}\w+Handler,$/m.test(withImport)
    ? insertAfterLast(withImport, /^ {4}\w+Handler,$/gm, `    ${Name}Handler,\n`, moduleFile)
    : appendToArray(withImport, /providers: \[/, `${Name}Handler`, moduleFile);
});

const touched = changes.apply(dryRun);
if (!dryRun) {
  tidy(touched);
  console.log(`
${Name}${Kind} scaffolded and registered in ${module}.module.ts. Next:
  - give the ${kind} its real fields and replace the placeholder in the handler;
  - turn the it.todo in ${specPath} into tests;
  - expose it through a controller (rules in .claude/rules/http.md).`);
  if (repo) {
    console.log(`  - methods of ${repo.type} beyond findById/save go into ${fakesPath} too.`);
  }
}

function repositoryNames(aggregate: string): { token: string; type: string; field: string } {
  const kebab = kebabFromPascal(aggregate);
  return {
    token: `${constantCase(kebab)}_REPOSITORY`,
    type: `${aggregate}Repository`,
    field: plural(camel(kebab)),
  };
}

function plural(word: string): string {
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

function commandTemplate(): string {
  if (!repo || !Aggregate) {
    return `import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

export class ${Name}Command extends Command<void> {
  constructor(readonly actor: Principal) {
    super();
  }
}

@CommandHandler(${Name}Command)
export class ${Name}Handler implements ICommandHandler<${Name}Command> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Handlers stay thin: load the aggregate, call the transition that enforces the rules, save it
  // inside the unit of work.
  execute(command: ${Name}Command): Promise<void> {
    return this.uow.run(() =>
      Promise.reject(new Error(\`\${command.constructor.name} is not implemented yet\`)),
    );
  }
}
`;
  }
  const variable = camel(kebabFromPascal(Aggregate));
  return `import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import { ${repo.token}, type ${repo.type} } from '../../domain';

export class ${Name}Command extends Command<void> {
  constructor(
    readonly actor: Principal,
    readonly ${variable}Id: string,
  ) {
    super();
  }
}

@CommandHandler(${Name}Command)
export class ${Name}Handler implements ICommandHandler<${Name}Command> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(${repo.token}) private readonly ${repo.field}: ${repo.type},
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Load, call the transition that enforces the rules, save: the unit of work commits the change
  // and its events together.
  async execute(command: ${Name}Command): Promise<void> {
    await this.uow.run(async () => {
      const ${variable} = await this.${repo.field}.findById(command.${variable}Id);
      if (!${variable}) {
        throw new EntityNotFoundError('${Aggregate}', command.${variable}Id);
      }
      // ${variable}.<transition>(this.clock.now());
      await this.${repo.field}.save(${variable});
    });
  }
}
`;
}

function queryTemplate(): string {
  if (!repo || !Aggregate) {
    return `import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';

import { type ${Name}Dto } from '../dto/${file}.dto';

export class ${Name}Query extends Query<${Name}Dto> {
  constructor(readonly actor: Principal) {
    super();
  }
}

@QueryHandler(${Name}Query)
export class ${Name}Handler implements IQueryHandler<${Name}Query> {
  execute(query: ${Name}Query): Promise<${Name}Dto> {
    return Promise.reject(new Error(\`\${query.constructor.name} is not implemented yet\`));
  }
}
`;
  }
  const variable = camel(kebabFromPascal(Aggregate));
  return `import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import { ${repo.token}, type ${repo.type} } from '../../domain';
import { type ${Name}Dto } from '../dto/${file}.dto';

export class ${Name}Query extends Query<${Name}Dto> {
  constructor(
    readonly actor: Principal,
    readonly ${variable}Id: string,
  ) {
    super();
  }
}

@QueryHandler(${Name}Query)
export class ${Name}Handler implements IQueryHandler<${Name}Query> {
  constructor(@Inject(${repo.token}) private readonly ${repo.field}: ${repo.type}) {}

  async execute(query: ${Name}Query): Promise<${Name}Dto> {
    const ${variable} = await this.${repo.field}.findById(query.${variable}Id);
    if (!${variable}) {
      throw new EntityNotFoundError('${Aggregate}', query.${variable}Id);
    }
    return { id: ${variable}.id };
  }
}
`;
}

function specTemplate(): string {
  const test = `../../../../../test`;
  if (!repo || !Aggregate) {
    return `describe('${Name}${Kind}', () => {
  it.todo('should <do something> when <condition>');
});
`;
  }
  const variable = camel(kebabFromPascal(Aggregate));
  const commandSetup =
    kind === 'command'
      ? `  const handler = new ${Name}Handler(new InlineUnitOfWork(), ${repo.field}, clock);`
      : `  const handler = new ${Name}Handler(${repo.field});`;
  return `import { type Principal } from '@shared/application';
import { EntityNotFoundError, FixedClock } from '@shared/domain';

import { InMemory${repo.type} } from '${test}/fakes/${module}';
import { ${kind === 'command' ? 'InlineUnitOfWork, ' : ''}RecordingEventBus } from '${test}/fakes/shared';

import { ${Name}${Kind}, ${Name}Handler } from './${file}.${kind}';

const ACTOR: Principal = { kind: 'user', userId: 'u-1', roles: ['ops'], centerId: null };
const MISSING_ID = '0199a000-0000-7000-8000-0000000000ff';

function setup() {
  const clock = new FixedClock(new Date('2026-10-09T10:00:00Z'));
  const events = new RecordingEventBus();
  const ${repo.field} = new InMemory${repo.type}(events);
${commandSetup}
  return { clock, events, ${repo.field}, handler };
}

describe('${Name}${Kind}', () => {
  it('should report a ${variable} that does not exist as not found', async () => {
    const t = setup();

    await expect(t.handler.execute(new ${Name}${Kind}(ACTOR, MISSING_ID))).rejects.toThrow(
      EntityNotFoundError,
    );
  });

  it.todo('should <do something> when <condition>');
});
`;
}
