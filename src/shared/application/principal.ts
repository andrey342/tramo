// Who is calling. The iam module authenticates requests and attaches one of these; everything
// downstream (authorization, idempotency scope, audit log) works on this type only.
export type Principal =
  | {
      readonly kind: 'user';
      readonly userId: string;
      readonly roles: readonly string[];
      readonly centerId: string | null;
    }
  | {
      readonly kind: 'api_key';
      readonly apiKeyId: string;
      readonly centerId: string;
      readonly scopes: readonly string[];
    }
  | { readonly kind: 'anonymous' };

export const ANONYMOUS: Principal = Object.freeze({ kind: 'anonymous' });

export function principalId(principal: Principal): string | null {
  switch (principal.kind) {
    case 'user':
      return principal.userId;
    case 'api_key':
      return principal.apiKeyId;
    case 'anonymous':
      return null;
  }
}
