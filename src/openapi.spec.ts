import { type DynamicModule, type INestApplication, type Type } from '@nestjs/common';
import { DECORATORS, DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { IDEMPOTENCY_STATUSES, IDEMPOTENT } from '@shared/infrastructure/http';

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
});
