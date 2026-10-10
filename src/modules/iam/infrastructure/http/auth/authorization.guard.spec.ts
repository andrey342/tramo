import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { type Principal } from '@shared/application';
import { type ApiKeyScope, type Role } from '@shared/domain';
import {
  IS_PUBLIC,
  REQUIRED_ROLES,
  REQUIRED_SCOPES,
} from '@shared/infrastructure/http/access.decorators';

import { AuthorizationGuard } from './authorization.guard';

function contextFor(
  principal: Principal | undefined,
  metadata: { roles?: Role[]; scopes?: ApiKeyScope[]; isPublic?: boolean },
): ExecutionContext {
  const handler = (): void => undefined;
  if (metadata.roles) Reflect.defineMetadata(REQUIRED_ROLES, metadata.roles, handler);
  if (metadata.scopes) Reflect.defineMetadata(REQUIRED_SCOPES, metadata.scopes, handler);
  if (metadata.isPublic) Reflect.defineMetadata(IS_PUBLIC, true, handler);
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
}

const student: Principal = { kind: 'user', userId: 'u', roles: ['student'], centerId: null };
const ops: Principal = { kind: 'user', userId: 'o', roles: ['ops'], centerId: null };
const key: Principal = {
  kind: 'api_key',
  apiKeyId: 'k',
  centerId: 'c',
  scopes: ['applications:read'],
};

describe('AuthorizationGuard', () => {
  const guard = new AuthorizationGuard(new Reflector());

  it('should let public routes through for anyone', () => {
    expect(guard.canActivate(contextFor(undefined, { isPublic: true }))).toBe(true);
  });

  it('should check user roles when the route names them', () => {
    expect(guard.canActivate(contextFor(ops, { roles: ['ops'] }))).toBe(true);
    expect(() => guard.canActivate(contextFor(student, { roles: ['ops'] }))).toThrow(/role/);
  });

  it('should keep users out of routes that do not name roles', () => {
    expect(() => guard.canActivate(contextFor(student, {}))).toThrow(
      /does not declare which roles/,
    );
  });

  it('should keep users out of routes opened only to api keys', () => {
    expect(() => guard.canActivate(contextFor(student, { scopes: ['applications:read'] }))).toThrow(
      /only available to API keys/,
    );
  });

  it('should require every declared scope from an api key and reject undeclared routes', () => {
    expect(guard.canActivate(contextFor(key, { scopes: ['applications:read'] }))).toBe(true);
    expect(() =>
      guard.canActivate(contextFor(key, { scopes: ['applications:read', 'programs:write'] })),
    ).toThrow(/scopes/);
    expect(() => guard.canActivate(contextFor(key, { roles: ['ops'] }))).toThrow(
      /not available to API keys/,
    );
  });

  it('should ask anonymous callers to authenticate', () => {
    expect(() => guard.canActivate(contextFor(undefined, {}))).toThrow(/Authentication/);
  });
});
