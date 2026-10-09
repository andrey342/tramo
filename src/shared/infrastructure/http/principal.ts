import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type Request } from 'express';

import { ANONYMOUS, type Principal } from '@shared/application';

export type RequestWithPrincipal = Request & { principal?: Principal };

export function principalOf(request: RequestWithPrincipal): Principal {
  return request.principal ?? ANONYMOUS;
}

// Controllers receive the caller (user or center API key) through this decorator instead of
// reading `req.user`, so they never depend on how authentication was performed.
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal =>
    principalOf(context.switchToHttp().getRequest<RequestWithPrincipal>()),
);
