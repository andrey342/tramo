import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { type ApiKeyScope, type Role } from '@shared/domain';
import {
  IS_PUBLIC,
  REQUIRED_ROLES,
  REQUIRED_SCOPES,
} from '@shared/infrastructure/http/access.decorators';
import { principalOf, type RequestWithPrincipal } from '@shared/infrastructure/http/principal';
import { ProblemException } from '@shared/infrastructure/http/problem-details';

// Global, after authentication. Coarse checks only (role, API key scope); rules that depend on the
// resource (is this the student's own application?) belong to the use case.
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets)) {
      return true;
    }
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, targets);
    const scopes = this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(
      REQUIRED_SCOPES,
      targets,
    );
    const principal = principalOf(context.switchToHttp().getRequest<RequestWithPrincipal>());

    switch (principal.kind) {
      case 'user':
        // A route opened to API keys is not implicitly open to every user: it must name roles.
        if (scopes && !roles) {
          throw forbidden('This endpoint is only available to API keys.');
        }
        if (roles && !roles.some((role) => principal.roles.includes(role))) {
          throw forbidden('Your role does not allow this operation.');
        }
        return true;
      case 'api_key':
        if (!scopes) {
          throw forbidden('This endpoint is not available to API keys.');
        }
        if (!scopes.every((scope) => principal.scopes.includes(scope))) {
          throw forbidden(`This API key needs the scopes: ${scopes.join(', ')}.`);
        }
        return true;
      case 'anonymous':
        throw new ProblemException(
          HttpStatus.UNAUTHORIZED,
          'unauthenticated',
          'Authentication is required.',
        );
    }
  }
}

function forbidden(detail: string): ProblemException {
  return new ProblemException(HttpStatus.FORBIDDEN, 'forbidden', detail);
}
