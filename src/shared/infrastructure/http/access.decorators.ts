import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';

import { type ApiKeyScope, type Role } from '@shared/domain';

export const IS_PUBLIC = Symbol('IS_PUBLIC');
export const REQUIRED_ROLES = Symbol('REQUIRED_ROLES');
export const REQUIRED_SCOPES = Symbol('REQUIRED_SCOPES');
export const AUTHENTICATION_OPTIONAL = Symbol('AUTHENTICATION_OPTIONAL');

// Every route requires authentication unless it says otherwise; forgetting a decorator fails
// closed. The iam module installs the global guards that read this metadata.
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

// Open to anyone, but a caller who sends credentials is identified (and refused if they are
// invalid), so the handler can show more to the right people (a center sees its draft programs).
export const OptionalAuthentication = (): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(IS_PUBLIC, true), SetMetadata(AUTHENTICATION_OPTIONAL, true));

// The user must hold at least one of the roles. Users are refused on routes without it.
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(REQUIRED_ROLES, roles), ApiBearerAuth());

// Opens the route to center API keys holding all of these scopes. Routes without it reject API
// keys, so a key can never reach an endpoint that was not designed for integrations.
export const RequireScopes = (...scopes: ApiKeyScope[]): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(REQUIRED_SCOPES, scopes), ApiSecurity('api-key'));
