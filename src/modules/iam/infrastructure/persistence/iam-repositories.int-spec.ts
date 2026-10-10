import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { ConcurrentModificationError } from '@shared/domain';
import { CoreModule } from '@shared/infrastructure/core.module';

import { aCenterAdmin, aStudent } from '../../../../../test/factories/iam';
import { eventually } from '../../../../../test/helpers/eventually';
import {
  EmailAlreadyRegisteredError,
  IamEvents,
  REFRESH_TOKEN_REPOSITORY,
  RefreshToken,
  type RefreshTokenRepository,
  USER_REPOSITORY,
  type UserRepository,
} from '../../domain';
import { IamModule } from '../../iam.module';

describe('iam repositories (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;
  let users: UserRepository;
  let tokens: RefreshTokenRepository;
  let db: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), IamModule],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
    users = app.get(USER_REPOSITORY);
    tokens = app.get(REFRESH_TOKEN_REPOSITORY);
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should round-trip a user and write its event to the outbox in the same transaction', async () => {
    const admin = aCenterAdmin({ centerId: '0199a000-0000-7000-8000-000000000001' });
    await uow.run(() => users.save(admin));

    const loaded = await users.findByEmail(admin.email.value);
    expect(loaded).toMatchObject({ id: admin.id, roles: ['center_admin'], version: 1 });
    expect(loaded?.centerId).toBe(admin.centerId);
    const outbox: { event_type: string }[] = await db.query(
      'SELECT event_type FROM shared.outbox_messages WHERE aggregate_id = $1',
      [admin.id],
    );
    expect(outbox.map((row) => row.event_type)).toEqual([IamEvents.CenterUserCreated]);
  });

  it('should translate the unique email index into the domain error', async () => {
    const first = aStudent({ email: 'same.person@example.com' });
    const second = aStudent({ email: 'same.person@example.com' });
    await uow.run(() => users.save(first));

    await expect(uow.run(() => users.save(second))).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('should refuse to overwrite a change made by someone else since loading', async () => {
    const student = aStudent();
    await uow.run(() => users.save(student));
    const copyA = await users.findById(student.id);
    const copyB = await users.findById(student.id);

    copyA?.disable();
    await uow.run(() => users.save(copyA!));
    copyB?.replacePasswordHash('fake:new');

    await expect(uow.run(() => users.save(copyB!))).rejects.toThrow(ConcurrentModificationError);
    expect((await users.findById(student.id))?.status).toBe('disabled');
  });

  it('should revoke a whole refresh token family in one statement', async () => {
    const student = aStudent();
    await uow.run(() => users.save(student));
    const now = new Date('2026-10-09T10:00:00Z');
    const issue = (id: string, family: string, hash: string): RefreshToken =>
      RefreshToken.issue({
        id,
        familyId: family,
        userId: student.id,
        tokenHash: hash,
        now,
        ttlMs: 60_000,
        familyExpiresAt: new Date(now.getTime() + 120_000),
      });
    const familyA = '0199a000-0000-7000-8000-00000000000a';
    const familyB = '0199a000-0000-7000-8000-00000000000b';
    await uow.run(async () => {
      await tokens.save(issue('0199a000-0000-7000-8000-0000000000a1', familyA, `a1-${student.id}`));
      await tokens.save(issue('0199a000-0000-7000-8000-0000000000a2', familyA, `a2-${student.id}`));
      await tokens.save(issue('0199a000-0000-7000-8000-0000000000b1', familyB, `b1-${student.id}`));
    });

    const revoked = await uow.run(() => tokens.revokeFamily(familyA, now));

    expect(revoked).toBe(2);
    expect((await tokens.findByTokenHash(`a2-${student.id}`))?.status).toBe('revoked');
    expect((await tokens.findByTokenHash(`b1-${student.id}`))?.status).toBe('active');
  });

  it('should revoke the token a concurrent rotation commits while the family is being revoked', async () => {
    const student = aStudent();
    await uow.run(() => users.save(student));
    const now = new Date('2026-10-09T10:00:00Z');
    const family = '0199a000-0000-7000-8000-00000000000c';
    const issue = (id: string, hash: string): RefreshToken =>
      RefreshToken.issue({
        id,
        familyId: family,
        userId: student.id,
        tokenHash: hash,
        now,
        ttlMs: 60_000,
        familyExpiresAt: new Date(now.getTime() + 120_000),
      });
    await uow.run(() =>
      tokens.save(issue('0199a000-0000-7000-8000-0000000000c1', `c1-${student.id}`)),
    );

    let lockTaken!: () => void;
    let finishRotation!: () => void;
    const locked = new Promise<void>((resolve) => (lockTaken = resolve));
    const proceed = new Promise<void>((resolve) => (finishRotation = resolve));
    const rotation = uow.run(async () => {
      await tokens.lockFamily(family);
      lockTaken();
      await proceed;
      await tokens.save(issue('0199a000-0000-7000-8000-0000000000c2', `c2-${student.id}`));
    });
    await locked;
    const revocation = uow.run(() => tokens.revokeFamily(family, now));
    await eventually(async () => {
      const waiting: unknown[] = await db.query(
        "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
      );
      expect(waiting.length).toBeGreaterThan(0);
    });
    finishRotation();
    const [, revoked] = await Promise.all([rotation, revocation]);

    expect(revoked).toBe(2);
    expect((await tokens.findByTokenHash(`c2-${student.id}`))?.status).toBe('revoked');
  });
});
