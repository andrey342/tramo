import { readdirSync, readFileSync } from 'node:fs';

import { type DynamicModule, type INestApplication, type Type } from '@nestjs/common';
import { DECORATORS, DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import {
  buildOpenApiDocument,
  IDEMPOTENCY_STATUSES,
  IDEMPOTENT,
} from '@shared/infrastructure/http';

import { AppModule } from './app.module';

type ModuleRef = Type | DynamicModule | Promise<DynamicModule>;
type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

// Every documented controller the api serves, found through the modules AppModule imports, so a
// new module or controller is checked without being listed here.
function controllersOf(module: ModuleRef, seen = new Set<unknown>()): Type[] {
  if (module instanceof Promise || seen.has(module)) {
    return [];
  }
  seen.add(module);
  const type = 'module' in module ? module.module : module;
  const metadata = (key: string): unknown[] =>
    (Reflect.getMetadata(key, type) as unknown[] | undefined) ?? [];
  const imports = [...metadata('imports'), ...('module' in module ? (module.imports ?? []) : [])];
  const controllers = [
    ...(metadata('controllers') as Type[]),
    ...('module' in module ? (module.controllers ?? []) : []),
  ];
  return [
    ...controllers,
    ...imports.flatMap((imported) => controllersOf(imported as ModuleRef, seen)),
  ];
}

// Clients generate their error handling from the OpenAPI document: the statuses that the HTTP
// pipeline itself answers must be on every route it runs for.
describe('OpenAPI document', () => {
  // @ApiExcludeController() stores `[true]`.
  const controllers = [...new Set(controllersOf(AppModule))].filter(
    (controller) =>
      (
        Reflect.getMetadata(DECORATORS.API_EXCLUDE_CONTROLLER, controller) as unknown[] | undefined
      )?.[0] !== true,
  );
  let app: INestApplication;
  let operations: { id: string; operation: Operation }[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers })
      .useMocker(() => ({}))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    operations = Object.values(document.paths).flatMap((item) =>
      (['get', 'post', 'put', 'patch', 'delete'] as const)
        .map((method) => item[method])
        .filter((operation): operation is Operation => operation !== undefined)
        .map((operation) => ({ id: operation.operationId ?? '', operation })),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const statusesOf = (operation: Operation): string[] => Object.keys(operation.responses);

  it('should document the idempotency statuses on every route marked @Idempotent()', () => {
    const idempotent = controllers.flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter((method) => {
          const handler: unknown = Reflect.get(controller.prototype as object, method);
          return typeof handler === 'function' && Reflect.getMetadata(IDEMPOTENT, handler) === true;
        })
        .map((method) => `${controller.name}_${method}`),
    );

    expect(idempotent.length).toBeGreaterThan(10);
    for (const id of idempotent) {
      const found = operations.find((entry) => entry.id === id);
      expect({ id, statuses: found ? statusesOf(found.operation) : [] }).toEqual({
        id,
        statuses: expect.arrayContaining(IDEMPOTENCY_STATUSES.map(String)),
      });
    }
  });

  it('should document 422 on every route that takes a cursor', () => {
    const paginated = operations.filter(({ operation }) =>
      (operation.parameters ?? []).some(
        (parameter) => 'in' in parameter && parameter.in === 'query' && parameter.name === 'cursor',
      ),
    );

    expect(paginated.length).toBeGreaterThanOrEqual(7);
    for (const { id, operation } of paginated) {
      expect({ id, statuses: statusesOf(operation) }).toEqual({
        id,
        statuses: expect.arrayContaining(['400', '422']),
      });
    }
  });

  // Users sign in with a bearer token; API keys reach only the routes that take scopes.
  it('should list each security scheme of a route once, and API keys only where they are taken', () => {
    const securityOf = (id: string): string[] =>
      (operations.find((entry) => entry.id === id)?.operation.security ?? []).flatMap((entry) =>
        Object.keys(entry),
      );

    expect(securityOf('MeController_me').sort()).toEqual(['api-key', 'bearer']);
    expect(securityOf('MeController_revokeSessions')).toEqual(['bearer']);
    for (const { id, operation } of operations) {
      const schemes = (operation.security ?? []).flatMap((entry) => Object.keys(entry));
      expect({ id, schemes }).toEqual({ id, schemes: [...new Set(schemes)] });
    }
  });

  // A client generated from the document sends what the validation accepts: whole numbers for
  // money, rates and terms; only scores are fractional.
  it('should describe money, rates and terms as integers', () => {
    const document = buildOpenApiDocument(app);
    const schemas = document.components?.schemas ?? {};
    const termsOf = (name: string): unknown =>
      (schemas[name] as { properties?: Record<string, unknown> } | undefined)?.properties?.[
        'allowedTerms'
      ];

    expect(termsOf('InstallmentsRequest')).toMatchObject({
      type: 'array',
      items: { type: 'integer' },
    });
    expect(termsOf('InstallmentsResponse')).toMatchObject({
      type: 'array',
      items: { type: 'integer' },
    });
    const numbers = Object.entries(schemas).flatMap(([schemaName, schema]) =>
      Object.entries(
        (schema as { properties?: Record<string, { type?: string }> }).properties ?? {},
      )
        .filter(([, property]) => property.type === 'number')
        .map(([property]) => `${schemaName}.${property}`),
    );
    expect(numbers.every((name) => /\.(score|averageScore|value|points)$/.test(name))).toBe(true);
    expect(
      (schemas['CreateProgramRequest'] as { properties?: Record<string, { type?: string }> })
        .properties?.['priceCents'],
    ).toMatchObject({ type: 'integer' });
  });

  // The document keys schemas by class name: a second DTO of the same name replaces the first, and
  // a route would be documented with another route's shape.
  it('should give every DTO class a name of its own', () => {
    const names = readdirSync('src/modules', { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.dto.ts'))
      .flatMap((file) =>
        [...readFileSync(`src/modules/${file}`, 'utf8').matchAll(/^(?:export )?class (\w+)/gm)].map(
          (match) => match[1],
        ),
      );

    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });

  // A property without a type of its own is documented as an empty object.
  it('should give every property a type, not an empty object', () => {
    const document = buildOpenApiDocument(app);
    const untyped = Object.entries(document.components?.schemas ?? {}).flatMap(
      ([schemaName, schema]) =>
        Object.entries(
          (schema as { properties?: Record<string, Record<string, unknown>> }).properties ?? {},
        )
          .filter(
            ([, property]) =>
              property['type'] === 'object' &&
              !['properties', 'additionalProperties', 'allOf', '$ref'].some(
                (key) => key in property,
              ),
          )
          .map(([property]) => `${schemaName}.${property}`),
    );

    expect(untyped).toEqual([]);
  });

  it('should describe whole-number query parameters as integers', () => {
    const document = buildOpenApiDocument(app);
    const parameters = Object.values(document.paths).flatMap((item) =>
      (['get', 'post', 'put', 'patch', 'delete'] as const).flatMap(
        (method) =>
          (item[method]?.parameters ?? []) as { name: string; schema?: { type?: string } }[],
      ),
    );

    expect(parameters.filter((parameter) => parameter.schema?.type === 'number')).toEqual([]);
    expect(parameters.find((parameter) => parameter.name === 'limit')?.schema).toMatchObject({
      type: 'integer',
    });
  });

  // Statuses the pipeline answers whatever the handler: a client generated from the document
  // knows to retry a 503 or a 429 and that only JSON bodies are taken.
  it('should document the statuses the pipeline answers on every route', () => {
    const document = buildOpenApiDocument(app);
    const at = (suffix: string) =>
      Object.entries(document.paths).find(([path]) => path.endsWith(suffix))?.[1].post;
    const login = at('/auth/login');
    const quote = at('/contracts/{contractId}/payoff-quote');
    const pspCallback = at('/webhooks/psp');

    expect(Object.keys(login?.responses ?? {})).toEqual(
      expect.arrayContaining(['413', '415', '429', '503']),
    );
    expect((quote?.requestBody as { required?: boolean } | undefined)?.required).toBe(false);
    expect(Object.keys(pspCallback?.responses ?? {})).not.toContain('429');
  });
});
