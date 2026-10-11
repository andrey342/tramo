// Demo data, safe to run any number of times: what exists is left alone.
//   pnpm seed   (against DATABASE_URL / REDIS_URL from .env, e.g. the compose stack)
// Accounts and their password are in scripts/demo-users.ts and the README. That password is public,
// so the script refuses to run with NODE_ENV=production.
import 'reflect-metadata';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
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
import { RegisterStudentCommand } from '../src/modules/iam/application/commands/register-student.command';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../src/modules/iam/application/ports/iam-ports';
import { User, USER_REPOSITORY, type UserRepository } from '../src/modules/iam/domain';
import { IamModule } from '../src/modules/iam/iam.module';
import { type ProfileInput } from '../src/modules/origination/application/application-input';
import { RunVerificationCommand } from '../src/modules/origination/application/commands/run-verification.command';
import { ScoreApplicationCommand } from '../src/modules/origination/application/commands/score-application.command';
import { StartApplicationCommand } from '../src/modules/origination/application/commands/start-application.command';
import { StartVerificationCommand } from '../src/modules/origination/application/commands/start-verification.command';
import { SubmitApplicationCommand } from '../src/modules/origination/application/commands/submit-application.command';
import {
  APPLICATION_QUERIES,
  type ApplicationQueries,
} from '../src/modules/origination/application/ports/origination-ports';
import { GetApplicationQuery } from '../src/modules/origination/application/queries/get-application.query';
import { OriginationModule } from '../src/modules/origination/origination.module';
import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '../src/shared/application';
import { CLOCK, type Clock, Email, unwrap, VatNumber } from '../src/shared/domain';
import { APP_CONFIG, type AppConfig, loadDotEnv } from '../src/shared/infrastructure/config';
import { CoreModule } from '../src/shared/infrastructure/core.module';

import { DEMO_PASSWORD, DEMO_USERS } from './demo-users';

@Module({
  imports: [
    CoreModule.forRoot({ applicationName: 'tramo-seed' }),
    IamModule,
    CatalogModule,
    OriginationModule,
  ],
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
            capMultiplierHundredths: 150,
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
  loadDotEnv();
  // Checked before the application connects (and possibly migrates) anything.
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('refusing to create demo accounts with a published password in production');
  }
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
        existing = await centers.findById(centerId);
      }
      // Checked right away so the demo does not depend on the worker being up; a center left
      // pending by an earlier run (VIES down) is checked again.
      if (existing?.status === 'pending_verification') {
        await commands.execute(new VerifyCenterVatCommand('system', existing.id));
        existing = await centers.findById(existing.id);
        log(`center ${center.name}: ${existing?.status ?? '?'}`);
      }
      if (existing && !(await users.findByEmail(center.admin))) {
        await commands.execute(
          new CreateCenterUserCommand(admin, existing.id, center.admin, DEMO_PASSWORD),
        );
        log(`center admin ${center.admin}`);
      }
      // Programs are created and published together, only once the center can publish: a run that
      // stopped between the two would leave drafts the next run does not see, and duplicate them.
      if (existing?.status !== 'active') {
        log(`center ${center.name} is not active yet; run the seed again to add its programs`);
      } else if ((await catalog.list({ centerId: existing.id }, { limit: 1 })).data.length === 0) {
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

    // The demo student, with one approved application and one waiting for an analyst. The
    // verification saga runs here directly, as the worker would.
    const student = await users.findByEmail(DEMO_USERS.student);
    const studentId =
      student?.id ??
      (await commands.execute(new RegisterStudentCommand(DEMO_USERS.student, DEMO_PASSWORD)))
        .userId;
    if (!student) log(`student ${DEMO_USERS.student}`);
    const applications = app.get<ApplicationQueries>(APPLICATION_QUERIES, { strict: false });
    const anyCenter = await centers.findByVatNumber(
      unwrap(VatNumber.create('ES', CENTERS[0].taxId(config.vies.mode))),
    );
    const programs = anyCenter
      ? (await catalog.list({ centerId: anyCenter.id }, { limit: 10 })).data
      : [];
    const bootcamp = programs.find((program) => program.name === CENTERS[0].programs[0].name);
    const master = programs.find((program) => program.name === CENTERS[0].programs[1].name);
    const hasApplications =
      (await applications.list({ applicantId: studentId }, { limit: 1 })).data.length > 0;
    if (bootcamp && master && !hasApplications) {
      const ana: Principal = {
        kind: 'user',
        userId: studentId,
        roles: ['student'],
        centerId: null,
      };
      const profile = {
        dateOfBirth: '1998-05-20',
        nationalId: '12345678Z',
        residenceCountry: 'ES',
        declaredMonthlyIncomeCents: 1_800_00,
        employmentStatus: 'employed' as const,
      };
      // Approved: 85 % employability, a long work record and an affordable payment.
      await applyAndVerify(ana, bootcamp.id, { kind: 'installments', termMonths: 24 }, profile);
      // Review: 58 % employability and no income to pay from.
      await applyAndVerify(
        ana,
        master.id,
        { kind: 'installments', termMonths: 36 },
        {
          ...profile,
          declaredMonthlyIncomeCents: 0,
          employmentStatus: 'unemployed',
        },
      );
    }

    async function applyAndVerify(
      actor: Principal,
      programId: string,
      product: { kind: 'installments'; termMonths: number },
      profile: ProfileInput,
    ): Promise<void> {
      const draft = await commands.execute(
        new StartApplicationCommand(actor, { programId, product, profile }),
      );
      await commands.execute(new SubmitApplicationCommand(actor, draft.id));
      await commands.execute(new StartVerificationCommand(draft.id));
      for (const type of ['kyc', 'employment', 'bureau'] as const) {
        await commands.execute(new RunVerificationCommand(draft.id, type));
      }
      await commands.execute(new ScoreApplicationCommand(draft.id));
      const result = await app.get(QueryBus).execute(new GetApplicationQuery(actor, draft.id));
      log(`application for ${draft.programName}: ${result.status}`);
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
