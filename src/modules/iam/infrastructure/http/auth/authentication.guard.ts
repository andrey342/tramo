import { type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { type Response } from 'express';

import { type Principal } from '@shared/application';
import { IS_PUBLIC } from '@shared/infrastructure/http/access.decorators';
import { type RequestWithPrincipal } from '@shared/infrastructure/http/principal';
import { ProblemException } from '@shared/infrastructure/http/problem-details';

// Global: authenticates every route that is not @Public and attaches the principal to the request.
@Injectable()
export class AuthenticationGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return (await super.canActivate(context)) as boolean;
  }

  // Passport puts the result of JwtStrategy.validate on req.user; the rest of the app reads
  // req.principal.
  // Generic only to match AuthGuard#handleRequest.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  override handleRequest<TUser = Principal>(
    error: unknown,
    principal: Principal | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (error || !principal) {
      context.switchToHttp().getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer');
      throw new ProblemException(
        HttpStatus.UNAUTHORIZED,
        'unauthenticated',
        'A valid access token is required.',
      );
    }
    context.switchToHttp().getRequest<RequestWithPrincipal>().principal = principal;
    return principal as TUser;
  }
}
