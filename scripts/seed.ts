// Demo data, safe to run any number of times: what exists is left alone.
//   pnpm seed   (against DATABASE_URL / REDIS_URL from .env, e.g. the compose stack)
// Accounts and their password are in scripts/demo-users.ts and the README.
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CommandBus } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { CreateProgramCommand } from '../src/modules/catalog/application/commands/create-program.command';
import { RegisterTrainingCenterCommand } from '../src/modules/catalog/application/commands/register-training-center.command';
import { UpdateProgramCommand } from '../src/modules/catalog/application/commands/update-program.command';
import { VerifyCenterVatCommand } from '../src/modules/catalog/application/commands/verify-center-vat.command';
import {
  PROGRAM_CATALOG,
  type ProgramCatalog,
} from '../src/modules/catalog/application/ports/catalog-ports';
import { CatalogModule } from '../src/modules/catalog/catalog.module';
import {
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '../src/modules/catalog/domain';
import { CreateCenterUserCommand } from '../src/modules/iam/application/commands/create-center-user.command';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../src/modules/iam/application/ports/iam-ports';
import { User, USER_REPOSITORY, type UserRepository } from '../src/modules/iam/domain';
import { IamModule } from '../src/modules/iam/iam.module';
import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '../src/shared/application';
import { CLOCK, type Clock, Email, unwrap, VatNumber } from '../src/shared/domain';
import { APP_CONFIG, type AppConfig } from '../src/shared/infrastructure/config';
import { CoreModule } from '../src/shared/infrastructure/core.module';

import { DEMO_PASSWORD, DEMO_USERS } from './demo-users';

@Module({
  imports: [CoreModule.forRoot({ applicationName: 'tramo-seed' }), IamModule, CatalogModule],
})
class SeedModule {}

const CENTERS = [
  {
    name: 'Codeworks Barcelona',
    // 100 is the number the VIES test service answers as valid.
    taxId: (mode: string) => (mode === 'test' ? '100' : 'B66079911'),
    payoutIban: 'ES9121000418450200051332',
    platformFeeBasisPoints: 500,
    admin: DEMO_USERS.center,
    programs: [
      {
        name: 'Full Stack Web Development Bootcamp',
        modality: 'hybrid',
        priceCents: 7_500_00,
        durationWeeks: 16,
        startDates: ['2027-01-11', '2027-04-05'],
        employabilityRateBasisPoints: 8_700,
        avgStartingSalaryCents: 28_000_00,
        financing: {
          installments: { allowedTerms: [12, 24, 36], annualRateBasisPoints: 790 },
          isa: {
            incomeShareBasisPoints: 1_000,
            minMonthlyIncomeCents: 1_500_00,
            maxPayments: 36,
            capMultiplier: 1.5,
            graceMonths: 3,
          },
        },
      },
      {
        name: 'Data Science Master',
        modality: 'online',
        priceCents: 9_900_00,
        durationWeeks: 36,
        startDates: ['2027-02-01'],
        employabilityRateBasisPoints: 5_800,
        avgStartingSalaryCents: 32_000_00,
        financing: { installments: { allowedTerms: [12, 24, 36, 48], annualRateBasisPoints: 690 } },
      },
    ],
  },
] as const;

async function seed(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn'] });
  try {
    const config = app.get<AppConfig>(APP_CONFIG);
    const commands = app.get(CommandBus);
    const users = app.get<UserRepository>(USER_REPOSITORY, { strict: false });
    const hasher = app.get<PasswordHasher>(PASSWORD_HASHER, { strict: false });
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK);
    const clock = app.get<Clock>(CLOCK);
    const centers = app.get<TrainingCenterRepository>(TRAINING_CENTER_REPOSITORY, {
      strict: false,
    });
    const catalog = app.get<ProgramCatalog>(PROGRAM_CATALOG, { strict: false });

    const adminId = await ensureStaff('admin', DEMO_USERS.admin);
    await ensureStaff('ops', DEMO_USERS.ops);
    const admin: Principal = { kind: 'user', userId: adminId, roles: ['admin'], centerId: null };

    for (const center of CENTERS) {
      const vatNumber = unwrap(VatNumber.create('ES', center.taxId(config.vies.mode)));
      let existing = await centers.findByVatNumber(vatNumber);
      if (!existing) {
        const { centerId } = await commands.execute(
          new RegisterTrainingCenterCommand(
            admin,
            center.name,
            'ES',
            vatNumber.number,
            center.payoutIban,
            center.platformFeeBasisPoints,
          ),
        );
        // Checked right away so the demo does not depend on the worker being up.
        await commands.execute(new VerifyCenterVatCommand('system', centerId));
        existing = await centers.findById(centerId);
        log(`center ${center.name}: ${existing?.status ?? '?'}`);
      }
      if (existing && !(await users.findByEmail(center.admin))) {
        await commands.execute(
          new CreateCenterUserCommand(admin, existing.id, center.admin, DEMO_PASSWORD),
        );
        log(`center admin ${center.admin}`);
      }
      if (
        existing &&
        (await catalog.list({ centerId: existing.id }, { limit: 1 })).data.length === 0
      ) {
        for (const program of center.programs) {
          const { financing, ...details } = program;
          const draft = await commands.execute(
            new CreateProgramCommand(admin, existing.id, details, financing),
          );
          await commands.execute(
            new UpdateProgramCommand(admin, draft.id, { status: 'published' }),
          );
          log(`program ${program.name}`);
        }
      }
    }

    async function ensureStaff(role: 'admin' | 'ops', email: string): Promise<string> {
      const found = await users.findByEmail(email);
      if (found) return found.id;
      const user = User.createStaff({
        id: uuidv7(),
        email: unwrap(Email.create(email)),
        passwordHash: await hasher.hash(DEMO_PASSWORD),
        roles: [role],
        now: clock.now(),
      });
      await uow.run(() => users.save(user));
      log(`${role} ${email}`);
      return user.id;
    }
  } finally {
    await app.close();
  }
}

function log(message: string): void {
  process.stdout.write(`seed: ${message}\n`);
}

seed().then(
  () => {
    log('done');
  },
  (error: unknown) => {
    process.stderr.write(
      `seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
