import { InvalidValueError } from '@shared/domain';

import { IamEvents } from '../events/iam-events';

import { ApiKey } from './api-key';
import { assertPasswordPolicy } from './password-policy';
import { RefreshToken } from './refresh-token';

const NOW = new Date('2026-10-09T10:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('RefreshToken', () => {
  const issue = (): RefreshToken =>
    RefreshToken.issue({
      id: 't-1',
      familyId: 'f-1',
      userId: 'u-1',
      tokenHash: 'h',
      now: NOW,
      ttlMs: 30 * DAY_MS,
      familyExpiresAt: new Date(NOW.getTime() + 90 * DAY_MS),
    });

  it('should be consumed once while it is valid', () => {
    const token = issue();

    expect(token.consume(new Date(NOW.getTime() + DAY_MS)).ok).toBe(true);
    expect(token.status).toBe('rotated');
    expect(token.usedAt).toEqual(new Date(NOW.getTime() + DAY_MS));
  });

  it('should treat a token presented again within seconds as a retry, not as theft', () => {
    const token = issue();
    token.consume(NOW);

    expect(token.consume(new Date(NOW.getTime() + 5_000))).toEqual({
      ok: false,
      error: 'superseded',
    });
  });

  it('should report reuse when a consumed token comes back, even after it expired', () => {
    const token = issue();
    token.consume(NOW);

    const second = token.consume(new Date(NOW.getTime() + 40 * DAY_MS));

    expect(second).toEqual({ ok: false, error: 'reused' });
  });

  it('should reject an expired token at its exact expiry', () => {
    const token = issue();

    expect(token.consume(token.expiresAt)).toEqual({ ok: false, error: 'expired' });
    expect(token.status).toBe('active');
  });

  it('should never outlive its session', () => {
    const late = RefreshToken.issue({
      id: 't-3',
      familyId: 'f-1',
      userId: 'u-1',
      tokenHash: 'h',
      now: NOW,
      ttlMs: 30 * DAY_MS,
      familyExpiresAt: new Date(NOW.getTime() + 10 * DAY_MS),
    });

    expect(late.expiresAt).toEqual(new Date(NOW.getTime() + 10 * DAY_MS));
    expect(late.familyExpiresAt).toEqual(late.expiresAt);
  });

  it('should reject a revoked token', () => {
    const token = RefreshToken.reconstitute('t-2', {
      familyId: 'f-1',
      userId: 'u-1',
      tokenHash: 'h',
      status: 'revoked',
      issuedAt: NOW,
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      familyExpiresAt: new Date(NOW.getTime() + DAY_MS),
      usedAt: null,
    });

    expect(token.consume(NOW)).toEqual({ ok: false, error: 'revoked' });
    expect([token.familyId, token.userId, token.tokenHash]).toEqual(['f-1', 'u-1', 'h']);
    expect(token.issuedAt).toEqual(NOW);
  });
});

describe('ApiKey', () => {
  const issue = (): ApiKey =>
    ApiKey.issue({
      id: 'k-1',
      centerId: 'center-1',
      name: '  Admissions integration ',
      prefix: 'ab12cd34',
      secretHash: 'hash',
      scopes: ['applications:write', 'applications:write', 'programs:read'],
      issuedBy: 'u-2',
      now: NOW,
    });

  it('should be issued active, with unique scopes and an event without the secret', () => {
    const key = issue();

    expect(key.isActive).toBe(true);
    expect(key.name).toBe('Admissions integration');
    expect(key.scopes).toEqual(['applications:write', 'programs:read']);
    const [event] = key.pullEvents();
    expect(event?.eventType).toBe(IamEvents.ApiKeyIssued);
    expect(JSON.stringify(event?.payload)).not.toContain('hash');
  });

  it('should refuse a key without scopes or with an empty name', () => {
    const base = {
      id: 'k-2',
      centerId: 'center-1',
      prefix: 'p',
      secretHash: 'h',
      issuedBy: 'u',
      now: NOW,
    };

    expect(() => ApiKey.issue({ ...base, name: 'x', scopes: [] })).toThrow(InvalidValueError);
    expect(() => ApiKey.issue({ ...base, name: '   ', scopes: ['programs:read'] })).toThrow(
      InvalidValueError,
    );
  });

  it('should revoke once and announce it once', () => {
    const key = issue();
    key.pullEvents();

    key.revoke(NOW);
    key.revoke(new Date(NOW.getTime() + 1000));

    expect(key.isActive).toBe(false);
    expect(key.revokedAt).toEqual(NOW);
    expect(key.pullEvents().map((event) => event.eventType)).toEqual([IamEvents.ApiKeyRevoked]);
  });

  it('should record use at most once a minute', () => {
    const key = issue();

    expect(key.recordUse(NOW)).toBe(true);
    expect(key.recordUse(new Date(NOW.getTime() + 30_000))).toBe(false);
    expect(key.recordUse(new Date(NOW.getTime() + 60_000))).toBe(true);
    expect(key.lastUsedAt).toEqual(new Date(NOW.getTime() + 60_000));
  });
});

describe('password policy', () => {
  it.each([
    ['a'.repeat(11), false],
    ['a'.repeat(12), true],
    ['a'.repeat(128), true],
    ['a'.repeat(129), false],
  ])('should accept %#: length boundaries', (password, accepted) => {
    const check = (): void => {
      assertPasswordPolicy(password);
    };
    if (accepted) {
      expect(check).not.toThrow();
    } else {
      expect(check).toThrow(InvalidValueError);
    }
  });
});
