import { AggregateRoot, err, ok, type Result } from '@shared/domain';

export type RefreshTokenStatus = 'active' | 'rotated' | 'revoked';

// 'superseded': rotated moments ago, almost certainly a retried or parallel request from the
// legitimate client (lost response, double submit). Rejected, but not treated as theft.
export type RefreshRejection = 'expired' | 'revoked' | 'reused' | 'superseded';

export const REUSE_GRACE_MS = 10_000;

export interface RefreshTokenProps {
  readonly familyId: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly status: RefreshTokenStatus;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  // Hard end of the whole session, fixed at sign-in; rotation never moves it.
  readonly familyExpiresAt: Date;
  readonly usedAt: Date | null;
}

// One refresh token in a rotation chain ("family"). Every refresh consumes the presented token and
// issues the next one in the same family. A token that was already consumed coming back means it
// was copied: the whole family is revoked, which signs out both the thief and the user.
export class RefreshToken extends AggregateRoot {
  private constructor(
    id: string,
    private props: RefreshTokenProps,
  ) {
    super(id);
  }

  static issue(input: {
    id: string;
    familyId: string;
    userId: string;
    tokenHash: string;
    now: Date;
    ttlMs: number;
    familyExpiresAt: Date;
  }): RefreshToken {
    const expiresAt = Math.min(input.now.getTime() + input.ttlMs, input.familyExpiresAt.getTime());
    return new RefreshToken(input.id, {
      familyId: input.familyId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      status: 'active',
      issuedAt: input.now,
      expiresAt: new Date(expiresAt),
      familyExpiresAt: input.familyExpiresAt,
      usedAt: null,
    });
  }

  static reconstitute(id: string, props: RefreshTokenProps): RefreshToken {
    return new RefreshToken(id, props);
  }

  get familyId(): string {
    return this.props.familyId;
  }

  get userId(): string {
    return this.props.userId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get status(): RefreshTokenStatus {
    return this.props.status;
  }

  get issuedAt(): Date {
    return this.props.issuedAt;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get familyExpiresAt(): Date {
    return this.props.familyExpiresAt;
  }

  get usedAt(): Date | null {
    return this.props.usedAt;
  }

  // Marks the token as consumed. Reuse is checked first: a rotated token is evidence of theft even
  // if it has expired since.
  consume(now: Date): Result<void, RefreshRejection> {
    if (this.props.status === 'rotated') {
      const usedAt = this.props.usedAt?.getTime() ?? 0;
      return err(now.getTime() - usedAt < REUSE_GRACE_MS ? 'superseded' : 'reused');
    }
    if (this.props.status === 'revoked') {
      return err('revoked');
    }
    if (now.getTime() >= this.props.expiresAt.getTime()) {
      return err('expired');
    }
    this.props = { ...this.props, status: 'rotated', usedAt: now };
    return ok(undefined);
  }
}
