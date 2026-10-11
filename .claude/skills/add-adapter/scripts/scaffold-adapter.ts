// Scaffolds a new implementation of a port, the shared contract suite every implementation of the
// port must pass, and the specs that run it against the fake and the new adapter.
//   pnpm scaffold:adapter <module> <Port> <name> [--integration] [--runtime-fake] [--dry-run]
// --runtime-fake puts the fake in infrastructure/adapters and registers it, for ports whose fake is
// chosen by configuration at runtime (e2e, demo without network), not only in unit tests.
// e.g. `pnpm scaffold:adapter catalog VatValidator vies --integration` creates ViesVatValidator.
import { readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

import * as ts from 'typescript';

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
  pascal,
  read,
  ROOT,
  tidy,
} from '../../../lib/scaffold';

const USAGE =
  'usage: scaffold-adapter <module> <Port> <name> [--integration] [--runtime-fake] [--token <NAME>]';
const { positional, flags, options } = parseArgs(process.argv.slice(2));
const [module = '', Port = '', name = ''] = positional;
if (!module || !Port || !name) {
  fail(USAGE);
}
assertKebab(module, 'module');
assertPascal(Port, 'port');
assertKebab(name, 'adapter name');
const integration = flags.has('integration');
const runtimeFake = flags.has('runtime-fake');
const dryRun = flags.has('dry-run');

const base = `src/modules/${module}`;
const port = findPort(Port);
const portKebab = kebabFromPascal(Port);
// Injection token: `<PORT_NAME>` by convention, or --token when a port predates it (LOGIN_ATTEMPTS).
const token = options.get('token') ?? constantCase(portKebab);
if (!new RegExp(`export const ${token} = Symbol`).test(read(port.file))) {
  fail(`${port.file} declares ${Port} but no ${token} token next to it; pass --token <NAME>.`);
}
const Adapter = `${pascal(name)}${Port}`;
const adapterFile = `${base}/infrastructure/adapters/${name}-${portKebab}.ts`;
const contractFile = `test/contracts/${portKebab}.contract.ts`;
const contractFn = `${camel(portKebab)}Contract`;
const unitSpec = `${base}/infrastructure/adapters/${portKebab}.contract.spec.ts`;
// An adapter named after another module (`catalog`, `iam`) answers through that module's public
// queries. Its integration run boots both modules, which module code may not import, so it lives
// in test/integration.
const crossModule = name !== module && exists(`src/modules/${name}`);
const intSpec = crossModule
  ? `test/integration/${portKebab}.int-spec.ts`
  : `${base}/infrastructure/adapters/${portKebab}.contract.int-spec.ts`;
const fakesFile = runtimeFake
  ? `${base}/infrastructure/adapters/fake-${portKebab}.ts`
  : `test/fakes/${module}.ts`;
const moduleFile = `${base}/${module}.module.ts`;
const fake = exists(fakesFile)
  ? new RegExp(`export class (\\w+)\\s+(?:extends [^{]+)?implements ${Port}\\b`).exec(
      read(fakesFile),
    )?.[1]
  : undefined;
const FakeName = fake ?? `Fake${Port}`;
// Imports of the port and of every type its signatures mention, as seen from `target`.
const portImport = (target: string): string => typeImports(target).join('\n');

const changes = new ChangeSet();

changes.create(
  adapterFile,
  `import { Injectable } from '@nestjs/common';

${portImport(adapterFile)}

@Injectable()
export class ${Adapter} implements ${Port} {
${stubMembers(Adapter)}
}
`,
);

if (!exists(contractFile)) {
  changes.create(
    contractFile,
    `import { type ${Port} } from '${relativeImport(contractFile, port.file)}';

// Every implementation of ${Port} (the fake used by unit tests and each real adapter) runs this
// suite, so the fake cannot drift from production behaviour.
export function ${contractFn}(name: string, create: () => Promise<${Port}> | ${Port}): void {
  describe(\`\${name} (${Port} contract)\`, () => {
    let subject: ${Port};

    beforeEach(async () => {
      subject = await create();
    });

    it('should be created', () => {
      expect(subject).toBeDefined();
    });

    it.todo('should <behaviour every implementation shares> when <condition>');
  });
}
`,
  );
}

if (!fake) {
  if (!exists(fakesFile)) {
    changes.create(fakesFile, '');
  }
  changes.edit(
    fakesFile,
    (content) => `${addImport(
      runtimeFake ? addImport(content, "import { Injectable } from '@nestjs/common';") : content,
      portImport(fakesFile),
    )}
${runtimeFake ? '// Deterministic stand-in, selected by configuration where the real service is not wanted.\n@Injectable()\n' : ''}export class ${FakeName} implements ${Port} {
${stubMembers(FakeName)}
}
`,
  );
  // Tests take every double from test/fakes, also runtime ones: an application spec importing
  // from infrastructure would break the layer rules.
  if (runtimeFake) {
    const testFakes = `test/fakes/${module}.ts`;
    const reExport = `export { ${FakeName} } from '${relativeImport(testFakes, fakesFile)}';`;
    if (!exists(testFakes)) {
      changes.create(testFakes, `${reExport}\n`);
    } else {
      changes.edit(testFakes, (content) =>
        content.includes(reExport) ? content : `${content.trimEnd()}\n\n${reExport}\n`,
      );
    }
  }
}

// Test doubles for constructor dependencies the fakes commonly take.
const DOUBLES: Record<string, { build: string; from: string; name: string }> = {
  Clock: {
    build: `new FixedClock(new Date('2026-10-09T10:00:00Z'))`,
    from: '@shared/domain',
    name: 'FixedClock',
  },
  EventBus: { build: 'new RecordingEventBus()', from: 'fakes/shared', name: 'RecordingEventBus' },
  UnitOfWork: { build: 'new InlineUnitOfWork()', from: 'fakes/shared', name: 'InlineUnitOfWork' },
};
const doublesUsed = new Set<string>();

// A contract written by hand may take something other than a plain factory (see the login
// attempt tracker's harness); its runs are then left to the developer.
const contractTakesFactory =
  !exists(contractFile) || read(contractFile).includes(`create: () => Promise<${Port}> | ${Port}`);

// The contract call for one implementation, or undefined when it cannot be generated: the
// contract takes something else than a plain factory, or the constructor needs a dependency
// without a known test double. Those runs are written by hand.
const run = (implementation: string): string | undefined => {
  if (!contractTakesFactory) {
    console.warn(
      `note: ${contractFn} does not take a plain factory; run it for ${implementation} by hand.`,
    );
    return undefined;
  }
  const params = implementation === FakeName && fake ? constructorParams(fakesFile, fake) : [];
  const unknown = params.filter((type) => !(type in DOUBLES));
  if (unknown.length > 0) {
    console.warn(
      `note: ${implementation} needs ${unknown.join(', ')}; run the contract for it by hand.`,
    );
    return undefined;
  }
  const args = params.map((type) => {
    doublesUsed.add(type);
    return DOUBLES[type]?.build ?? '';
  });
  return `${contractFn}('${implementation}', () => new ${implementation}(${args.join(', ')}));\n`;
};
const doubleImports = (target: string): string =>
  [...doublesUsed]
    .map((type) => DOUBLES[type])
    .filter((double) => double !== undefined)
    .map((double) =>
      double.from.startsWith('@')
        ? `import { ${double.name} } from '${double.from}';`
        : `import { ${double.name} } from '${relativeImport(target, `test/${double.from}.ts`)}';`,
    )
    .join('\n');

// Appends a run to an existing spec, or creates the spec around its runs.
function addRuns(
  spec: string,
  runs: { implementation: string; importLine: string }[],
  note = '',
): void {
  doublesUsed.clear();
  const generated = runs
    .map((entry) => ({ ...entry, call: run(entry.implementation) }))
    .filter((entry): entry is typeof entry & { call: string } => entry.call !== undefined);
  if (generated.length === 0) {
    return;
  }
  if (exists(spec)) {
    changes.edit(
      spec,
      (content) =>
        generated.reduce((text, entry) => addImport(text, entry.importLine), content) +
        generated.map((entry) => entry.call).join(''),
    );
    return;
  }
  const imports = [
    doubleImports(spec),
    `import { ${contractFn} } from '${relativeImport(spec, contractFile)}';`,
    ...generated.map((entry) => entry.importLine),
  ].filter((line) => line.length > 0);
  changes.create(
    spec,
    `${imports.join('\n')}\n\n${note}${generated.map((entry) => entry.call).join('')}`,
  );
}

const fakeRun = {
  implementation: FakeName,
  importLine: `import { ${FakeName} } from '${relativeImport(unitSpec, fakesFile)}';`,
};
const adapterRun = {
  implementation: Adapter,
  importLine: `import { ${Adapter} } from './${name}-${portKebab}';`,
};
const intAdapterRun = crossModule
  ? {
      implementation: Adapter,
      importLine: `import { ${Adapter} } from '${relativeImport(intSpec, adapterFile)}';`,
    }
  : adapterRun;
addRuns(unitSpec, integration ? [fakeRun] : [fakeRun, adapterRun]);
if (integration) {
  addRuns(
    intSpec,
    [intAdapterRun],
    crossModule
      ? `// Crosses two modules (${module}'s adapter, ${name}'s query), so it lives outside both. Build\n// the subject from a Nest context that imports both modules.\n`
      : "// Runs against the real dependency (Testcontainers or the provider's test service).\n",
  );
}

// After the handlers, as in iam; a module without handlers yet gets it appended to providers.
changes.edit(moduleFile, (content) => {
  const withImport = addImport(
    content,
    `import { ${Adapter} } from './infrastructure/adapters/${name}-${portKebab}';`,
  );
  const registered = runtimeFake && !fake ? [Adapter, FakeName] : [Adapter];
  const withFake =
    runtimeFake && !fake
      ? addImport(
          withImport,
          `import { ${FakeName} } from './infrastructure/adapters/fake-${portKebab}';`,
        )
      : withImport;
  return /^ {4}\w+Handler,$/m.test(withFake)
    ? insertAfterLast(
        withFake,
        /^ {4}\w+Handler,$/gm,
        registered.map((provider) => `    ${provider},\n`).join(''),
        moduleFile,
      )
    : registered.reduce(
        (text, provider) => appendToArray(text, /providers: \[/, provider, moduleFile),
        withFake,
      );
});

const touched = changes.apply(dryRun);
if (!dryRun) {
  tidy(touched);
  console.log(`
${Adapter} scaffolded. Next:
  - implement it (the stubs throw) and the shared behaviour in ${contractFile};
  - ${fake ? `${FakeName} already exists and runs the contract too` : `implement ${FakeName} in ${fakesFile}`};
  - choose the implementation in ${moduleFile}. To switch by environment:
      env.schema.ts:  ${token}_ADAPTER: z.enum(['<current>', '${name}']).default('<current>'),
      app-config.ts:  adapters.${camel(portKebab)}: env.${token}_ADAPTER
      module:         { provide: ${token}, inject: [APP_CONFIG, <Current>, ${Adapter}],
                        useFactory: (config: AppConfig, current: <Current>, ${camel(name)}: ${Adapter}) =>
                          config.adapters.${camel(portKebab)} === '${name}' ? ${camel(name)} : current }
    and document the variable in .env.example and the README.`);
}

function findPort(portName: string): {
  file: string;
  node: ts.InterfaceDeclaration;
  source: ts.SourceFile;
} {
  for (const folder of [`${base}/application/ports`, `${base}/domain/ports`]) {
    if (!exists(folder)) continue;
    for (const entry of readdirSync(join(ROOT, folder))) {
      const file = `${folder}/${entry}`;
      const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
      const node = source.statements.find(
        (statement): statement is ts.InterfaceDeclaration =>
          ts.isInterfaceDeclaration(statement) && statement.name.text === portName,
      );
      if (node) {
        return { file, node, source };
      }
    }
  }
  return fail(`no interface ${portName} in ${base}/application/ports or ${base}/domain/ports.`);
}

// One stub per member of the port: methods reject or throw, properties are getters that throw.
function stubMembers(className: string): string {
  const { node, source } = port;
  return node.members
    .map((member) => {
      const memberName = member.name?.getText(source) ?? '';
      if (ts.isMethodSignature(member)) {
        const params = member.parameters
          .map(
            (param) =>
              `_${param.name.getText(source)}${param.questionToken ? '?' : ''}: ${param.type?.getText(source) ?? 'unknown'}`,
          )
          .join(', ');
        const returns = member.type?.getText(source) ?? 'void';
        const body = returns.startsWith('Promise<')
          ? `return Promise.reject(new Error('${className}.${memberName} is not implemented yet'));`
          : `throw new Error('${className}.${memberName} is not implemented yet');`;
        return `  ${memberName}(${params}): ${returns} {\n    ${body}\n  }`;
      }
      if (ts.isPropertySignature(member)) {
        const type = member.type?.getText(source) ?? 'unknown';
        return `  get ${memberName}(): ${type} {\n    throw new Error('${className}.${memberName} is not implemented yet');\n  }`;
      }
      return '';
    })
    .filter((stub) => stub.length > 0)
    .join('\n\n');
}

function relativeImport(from: string, to: string): string {
  const fromParts = from.split('/').slice(0, -1);
  const toParts = to.replace(/\.ts$/, '').split('/');
  let common = 0;
  while (common < fromParts.length && fromParts[common] === toParts[common]) common += 1;
  const up = fromParts.length - common;
  const path = [...Array<string>(up).fill('..'), ...toParts.slice(common)].join('/');
  return up === 0 ? `./${path}` : path;
}

// Type names a signature mentions (`Promise<IssuedAccessToken>` gives Promise and
// IssuedAccessToken); globals are filtered out later because nothing declares or imports them.
function referencedTypes(): Set<string> {
  const names = new Set<string>([Port]);
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      names.add(node.typeName.getText(port.source).split('.')[0] ?? '');
    }
    ts.forEachChild(node, visit);
  };
  port.node.members.forEach(visit);
  return names;
}

function typeImports(target: string): string[] {
  const bySource = new Map<string, Set<string>>();
  const add = (from: string, typeName: string): void => {
    bySource.set(from, (bySource.get(from) ?? new Set()).add(typeName));
  };
  for (const typeName of referencedTypes()) {
    const declaredHere = port.source.statements.some(
      (statement) =>
        (ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name?.text === typeName,
    );
    if (declaredHere) {
      add(relativeImport(target, port.file), typeName);
      continue;
    }
    const imported = port.source.statements.find(
      (statement): statement is ts.ImportDeclaration =>
        ts.isImportDeclaration(statement) &&
        statement.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (element) => element.name.text === typeName,
        ),
    );
    if (imported && ts.isStringLiteral(imported.moduleSpecifier)) {
      const specifier = imported.moduleSpecifier.text;
      add(
        specifier.startsWith('.')
          ? relativeImport(target, `${posix.join(posix.dirname(port.file), specifier)}.ts`)
          : specifier,
        typeName,
      );
    }
  }
  return [...bySource].map(
    ([from, typeNames]) =>
      `import { ${[...typeNames].map((typeName) => `type ${typeName}`).join(', ')} } from '${from}';`,
  );
}

// Parameter types of a class constructor, by their written name (`clock: Clock` gives Clock).
function constructorParams(file: string, className: string): string[] {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(
    (statement): statement is ts.ClassDeclaration =>
      ts.isClassDeclaration(statement) && statement.name?.text === className,
  );
  const constructor = declaration?.members.find(ts.isConstructorDeclaration);
  return (constructor?.parameters ?? []).map((param) => param.type?.getText(source) ?? 'unknown');
}
