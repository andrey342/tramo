import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';

import { type ApiKeyScope, type Role } from '@shared/domain';

export const IS_PUBLIC = Symbol('IS_PUBLIC');
export const REQUIRED_ROLES = Symbol('REQUIRED_ROLES');
export const REQUIRED_SCOPES = Symbol('REQUIRED_SCOPES');

// Every route requires authentication unless it says otherwise; forgetting a decorator fails
// closed. The iam module installs the global guards that read this metadata.
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

// The user must hold at least one of the roles.
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(REQUIRED_ROLES, roles), ApiBearerAuth());

// Opens the route to center API keys holding all of these scopes. Routes without it reject API
// keys, so a key can never reach an endpoint that was not designed for integrations.
export const RequireScopes = (...scopes: ApiKeyScope[]): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(REQUIRED_SCOPES, scopes), ApiSecurity('api-key'));
