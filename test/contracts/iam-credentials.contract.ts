import {
  type AccessTokenIssuer,
  type CredentialGenerator,
  type PasswordHasher,
} from '../../src/modules/iam/application/ports/iam-ports';
import { API_KEY_FORMAT } from '../../src/modules/iam/domain';
import { type Clock } from '../../src/shared/domain';

// Behaviour the handler tests rely on from the fakes, checked against the real adapters too.

export function passwordHasherContract(name: string, create: () => Promise<PasswordHasher>): void {
  describe(`${name} (PasswordHasher contract)`, () => {
    let hasher: PasswordHasher;

    beforeAll(async () => {
      hasher = await create();
    });

    it('should verify only the password that was hashed', async () => {
      const hash = await hasher.hash('correct horse battery');

      expect(await hasher.verify(hash, 'correct horse battery')).toBe(true);
      expect(await hasher.verify(hash, 'wrong horse battery')).toBe(false);
      expect(hasher.needsRehash(hash)).toBe(false);
    });

    it('should never accept a password against the decoy or a malformed hash', async () => {
      expect(await hasher.verify(hasher.decoyHash, 'anything at all')).toBe(false);
      expect(await hasher.verify('not-a-hash', 'not-a-hash')).toBe(false);
    });
  });
}

export function credentialGeneratorContract(name: string, create: () => CredentialGenerator): void {
  describe(`${name} (CredentialGenerator contract)`, () => {
    it('should generate distinct refresh tokens stored as their hash', () => {
      const generator = create();
      const a = generator.refreshToken();
      const b = generator.refreshToken();

      expect(a.value).not.toBe(b.value);
      expect(a.hash).not.toBe(a.value);
      expect(generator.hash(a.value)).toBe(a.hash);
    });

    it('should generate api keys in the published format with their visible prefix', () => {
      const generator = create();
      const key = generator.apiKey();

      expect(key.value).toMatch(API_KEY_FORMAT);
      expect(key.value.startsWith(`tramo_${key.prefix}_`)).toBe(true);
      expect(generator.hash(key.value)).toBe(key.hash);
      expect(generator.apiKey().value).not.toBe(key.value);
    });
  });
}

export function accessTokenIssuerContract(
  name: string,
  create: () => { issuer: AccessTokenIssuer; clock: Clock },
): void {
  describe(`${name} (AccessTokenIssuer contract)`, () => {
    it('should issue a token that expires expiresInSeconds after the clock time', async () => {
      const { issuer, clock } = create();

      const issued = await issuer.issue({ userId: 'u-1', roles: ['student'], centerId: null });

      expect(issued.token.length).toBeGreaterThan(0);
      expect(issued.expiresInSeconds).toBeGreaterThan(0);
      expect(issued.expiresAt.getTime() - clock.now().getTime()).toBe(
        issued.expiresInSeconds * 1000,
      );
    });
  });
}
