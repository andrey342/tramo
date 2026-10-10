import { type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QueryBus } from '@nestjs/cqrs';
import { AuthGuard } from '@nestjs/passport';
import { type Response } from 'express';

import { type Principal } from '@shared/application';
import { AUTHENTICATION_OPTIONAL, IS_PUBLIC } from '@shared/infrastructure/http/access.decorators';
import { type RequestWithPrincipal } from '@shared/infrastructure/http/principal';
import { ProblemException } from '@shared/infrastructure/http/problem-details';
import { API_KEY_HEADER } from '@shared/infrastructure/http/swagger';

import { AuthenticateApiKeyQuery } from '../../../application/queries/authenticate-api-key.query';

// Global: authenticates every route that is not @Public and attaches the principal to the request.
// A request carries either a center API key (X-Api-Key) or a user's bearer token.
@Injectable()
export class AuthenticationGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly queries: QueryBus,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const apiKey = request.header(API_KEY_HEADER);
    if (isPublic) {
      const optional = this.reflector.getAllAndOverride<boolean | undefined>(
        AUTHENTICATION_OPTIONAL,
        [context.getHandler(), context.getClass()],
      );
      const hasCredentials = apiKey !== undefined || request.header('authorization') !== undefined;
      if (!optional || !hasCredentials) {
        return true;
      }
    }
    if (apiKey !== undefined) {
      const principal = await this.queries.execute(new AuthenticateApiKeyQuery(apiKey));
      if (!principal) {
        throw new ProblemException(
          HttpStatus.UNAUTHORIZED,
          'invalid_api_key',
          'The API key is not valid or has been revoked.',
        );
      }
      request.principal = principal;
      return true;
    }
    return (await super.canActivate(context)) as boolean;
  }

  // Passport puts the result of JwtStrategy.validate on req.user; the rest of the app reads
  // req.principal. Generic only to match AuthGuard#handleRequest.
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
