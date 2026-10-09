import { type INestApplicationContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { type Redis } from 'ioredis';

import { CLOCK } from '@shared/domain';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { CoreModule } from '@shared/infrastructure/core.module';
import { REDIS_CLIENT } from '@shared/infrastructure/redis';

import { loginAttemptTrackerContract } from '../../../../test/contracts/login-attempt-tracker.contract';
import { API_KEY_FORMAT } from '../domain';

import { ARGON2_OPTIONS, Argon2PasswordHasher } from './adapters/argon2-password.hasher';
import { CryptoCredentialGenerator } from './adapters/crypto-credential.generator';
import { JWT_AUDIENCE, JWT_ISSUER, JwtAccessTokenIssuer } from './adapters/jwt-access-token.issuer';
import { RedisLoginAttemptTracker } from './adapters/redis-login-attempt.tracker';

describe('iam adapters (integration)', () => {
  let app: INestApplicationContext;
  let config: AppConfig;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' })],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    config = app.get<AppConfig>(APP_CONFIG);
  });

  afterAll(async () => {
    await app.close();
  });

  loginAttemptTrackerContract('RedisLoginAttemptTracker', () => {
    return new RedisLoginAttemptTracker(app.get<Redis>(REDIS_CLIENT), {
      ...config,
      auth: {
        ...config.auth,
        lockout: { maxFailures: 3, baseLockSeconds: 60, maxLockSeconds: 3600 },
      },
    });
  });

  describe('Argon2PasswordHasher', () => {
    const hasher = new Argon2PasswordHasher();

    beforeAll(async () => {
      await hasher.onModuleInit();
    });

    it('should hash with argon2id and verify only the right password', async () => {
      const hash = await hasher.hash('correct horse battery');

      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).toContain(`m=${String(ARGON2_OPTIONS.memoryCost)}`);
      expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
      expect(await hasher.verify(hash, 'wrong horse battery')).toBe(false);
      expect(hasher.needsRehash(hash)).toBe(false);
    });

    it('should ask for a rehash of weaker hashes and reject malformed ones', async () => {
      const argon2 = await import('argon2');
      const weak = await argon2.hash('pw', {
        type: argon2.argon2id,
        memoryCost: 8_192,
        timeCost: 1,
      });

      expect(hasher.needsRehash(weak)).toBe(true);
      expect(await hasher.verify('not-a-hash', 'pw')).toBe(false);
      expect(await hasher.verify(hasher.decoyHash, 'anything')).toBe(false);
    });
  });

  describe('CryptoCredentialGenerator', () => {
    const generator = new CryptoCredentialGenerator();

    it('should generate distinct secrets and hash them deterministically', () => {
      const a = generator.refreshToken();
      const b = generator.refreshToken();

      expect(a.value).not.toBe(b.value);
      expect(a.hash).toBe(generator.hash(a.value));
      expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should format api keys with a visible prefix', () => {
      const key = generator.apiKey();

      expect(key.value).toMatch(API_KEY_FORMAT);
      expect(key.value.startsWith(`tramo_${key.prefix}_`)).toBe(true);
    });
  });

  describe('JwtAccessTokenIssuer', () => {
    it('should sign tokens the api can verify, with issuer, audience and expiry', async () => {
      const jwt = new JwtService({ secret: config.auth.jwtSecret });
      const issuer = new JwtAccessTokenIssuer(jwt, config, app.get(CLOCK));

      const issued = await issuer.issue({ userId: 'u-1', roles: ['ops'], centerId: null });
      const payload = await jwt.verifyAsync<Record<string, unknown>>(issued.token, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });

      expect(payload).toMatchObject({ sub: 'u-1', roles: ['ops'], cid: null });
      expect(Number(payload.exp) - Number(payload.iat)).toBe(config.auth.accessTokenTtlSeconds);
    });
  });
});
