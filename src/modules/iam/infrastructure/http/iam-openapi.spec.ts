import { type INestApplication } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';

import { AuthController } from './auth.controller';
import { CenterAccessController } from './center-access.controller';
import { UsersController } from './users.controller';

// Clients generate their error handling from the OpenAPI document: every status a route can
// answer must be in it.
describe('iam OpenAPI document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, CenterAccessController, UsersController],
      providers: [
        { provide: CommandBus, useValue: {} },
        { provide: QueryBus, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  const statusesOf = (path: string): string[] =>
    Object.keys(document.paths[path]?.post?.responses ?? {});

  it('should document 422 on the routes where the domain can reject a value', () => {
    for (const path of [
      '/auth/register',
      '/centers/{centerId}/users',
      '/centers/{centerId}/api-keys',
      '/users/{userId}/disable',
    ]) {
      expect({ path, statuses: statusesOf(path) }).toEqual({
        path,
        statuses: expect.arrayContaining(['422']),
      });
    }
  });

  it('should document 404 when the center of a new user or key does not exist', () => {
    expect(statusesOf('/centers/{centerId}/users')).toContain('404');
    expect(statusesOf('/centers/{centerId}/api-keys')).toContain('404');
  });
});
