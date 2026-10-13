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
import { ConfigureWebhookCommand } from '../src/modules/notifications/application/commands/configure-webhook.command';
import {
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  type WebhookSubscriptionRepository,
} from '../src/modules/notifications/domain';
import { NotificationsModule } from '../src/modules/notifications/notifications.module';
import { type ProfileInput } from '../src/modules/origination/application/application-input';
import { RunVerificationCommand } from '../src/modules/origination/application/commands/run-verification.command';
import { ScoreApplicationCommand } from '../src/modules/origination/application/commands/score-application.command';
import { StartApplicationCommand } from '../src/modules/origination/application/commands/start-application.command';
import { SubmitApplicationCommand } from '../src/modules/origination/application/commands/submit-application.command';
import { type RequestedProductDto } from '../src/modules/origination/application/dto/application.dto';
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
    NotificationsModule,
  ],
})
class SeedModule {}

// Where the demo center's webhook posts: the compose sink, by its service name, as the worker
// container sees it. With the worker on the host (`dev` profile), set
// SEED_WEBHOOK_URL=http://localhost:9099/codeworks.
const WEBHOOK_URL = process.env['SEED_WEBHOOK_URL'] ?? 'http://webhook-sink:9099/codeworks';

// Admin of the second center; the first center's admin is the demo account in DEMO_USERS.
const OTHER_CENTER_ADMIN = 'admin@berlin-code.test';

// The VIES test service answers 100 as valid and 200 as invalid in every country, so in `test`
// mode (the compose default) each active center has 100 in its own country; `fake` accepts the
// realistic numbers too and refuses 200 as well.
const testOr = (realistic: string) => (mode: string) => (mode === 'test' ? '100' : realistic);

const CENTERS = [
  {
    name: 'Codeworks Barcelona',
    country: 'ES',
    taxId: testOr('B66079911'),
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
      {
        name: 'Cybersecurity Specialist Course',
        modality: 'hybrid',
        priceCents: 4_200_00,
        durationWeeks: 24,
        startDates: ['2027-01-25'],
        employabilityRateBasisPoints: 7_900,
        avgStartingSalaryCents: 27_000_00,
        financing: { installments: { allowedTerms: [6, 12, 18], annualRateBasisPoints: 650 } },
      },
    ],
  },
  {
    name: 'Berlin Code Academy',
    country: 'DE',
    taxId: testOr('DE811569869'),
    payoutIban: 'DE89370400440532013000',
    platformFeeBasisPoints: 450,
    admin: OTHER_CENTER_ADMIN,
    programs: [
      {
        name: 'UX/UI Design Bootcamp',
        modality: 'onsite',
        priceCents: 5_900_00,
        durationWeeks: 12,
        startDates: ['2027-01-18', '2027-05-03'],
        employabilityRateBasisPoints: 7_600,
        avgStartingSalaryCents: 24_000_00,
        financing: {
          installments: { allowedTerms: [12, 24], annualRateBasisPoints: 850 },
          isa: {
            incomeShareBasisPoints: 900,
            minMonthlyIncomeCents: 1_300_00,
            maxPayments: 30,
            capMultiplierHundredths: 140,
            graceMonths: 3,
          },
        },
      },
      {
        name: 'Cloud and DevOps Program',
        modality: 'online',
        priceCents: 6_800_00,
        durationWeeks: 20,
        startDates: ['2027-02-15'],
        employabilityRateBasisPoints: 8_200,
        avgStartingSalaryCents: 30_000_00,
        financing: { installments: { allowedTerms: [12, 24, 36], annualRateBasisPoints: 750 } },
      },
      {
        name: 'Mobile Development Bootcamp',
        modality: 'online',
        priceCents: 6_500_00,
        durationWeeks: 14,
        startDates: ['2027-03-01'],
        employabilityRateBasisPoints: 6_900,
        avgStartingSalaryCents: 25_000_00,
        financing: {
          installments: { allowedTerms: [12, 24], annualRateBasisPoints: 820 },
          isa: {
            incomeShareBasisPoints: 1_100,
            minMonthlyIncomeCents: 1_400_00,
            maxPayments: 36,
            capMultiplierHundredths: 150,
            graceMonths: 4,
          },
        },
      },
    ],
  },
  // The registry does not know its number: it stays pending, with nothing to publish.
  {
    name: 'Nova Cyber Institute',
    country: 'ES',
    taxId: () => '200',
    payoutIban: 'ES7921000813610123456789',
    platformFeeBasisPoints: 550,
    admin: null,
    programs: [],
  },
] as const;

const ANA = {
  dateOfBirth: '1998-05-20',
  nationalId: '56781234F',
  residenceCountry: 'ES',
  declaredMonthlyIncomeCents: 1_800_00,
  employmentStatus: 'employed',
} as const;

// One student per scenario of the README. The simulated bureau lists a national id whose number
// ends in 7 as a defaulter, and identity checks fail for one ending in 9.
const STUDENTS: readonly {
  readonly email: string;
  readonly applications: readonly {
    readonly program: string;
    readonly product: RequestedProductDto;
    readonly profile: ProfileInput;
  }[];
}[] = [
  {
    email: DEMO_USERS.student,
    applications: [
      // Approved: 87 % employability, 19 months of work on record and an affordable payment.
      {
        program: 'Full Stack Web Development Bootcamp',
        product: { kind: 'installments', termMonths: 24 },
        profile: ANA,
      },
      // Review: 58 % employability and no income to pay from.
      {
        program: 'Data Science Master',
        product: { kind: 'installments', termMonths: 36 },
        profile: { ...ANA, declaredMonthlyIncomeCents: 0, employmentStatus: 'unemployed' },
      },
    ],
  },
  {
    email: 'bruno.silva@example.com',
    applications: [
      {
        program: 'UX/UI Design Bootcamp',
        product: { kind: 'isa' },
        profile: {
          dateOfBirth: '2001-09-02',
          nationalId: '12345678Z',
          residenceCountry: 'ES',
          declaredMonthlyIncomeCents: 0,
          employmentStatus: 'student',
        },
      },
    ],
  },
  {
    email: 'carla.moreno@example.com',
    applications: [
      {
        program: 'Mobile Development Bootcamp',
        product: { kind: 'installments', termMonths: 24 },
        profile: {
          dateOfBirth: '1995-11-30',
          nationalId: '23456781R',
          residenceCountry: 'ES',
          declaredMonthlyIncomeCents: 900_00,
          employmentStatus: 'self_employed',
        },
      },
    ],
  },
  {
    email: 'diego.lopez@example.com',
    applications: [
      {
        program: 'Cloud and DevOps Program',
        product: { kind: 'installments', termMonths: 24 },
        profile: {
          dateOfBirth: '1993-04-17',
          nationalId: '67812347K',
          residenceCountry: 'ES',
          declaredMonthlyIncomeCents: 2_100_00,
          employmentStatus: 'employed',
        },
      },
    ],
  },
  {
    email: 'elena.ruiz@example.com',
    applications: [
      {
        program: 'Cybersecurity Specialist Course',
        product: { kind: 'installments', termMonths: 12 },
        profile: {
          dateOfBirth: '1999-01-08',
          nationalId: '78123459A',
          residenceCountry: 'ES',
          declaredMonthlyIncomeCents: 1_600_00,
          employmentStatus: 'employed',
        },
      },
    ],
  },
];

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
      const vatNumber = unwrap(VatNumber.create(center.country, center.taxId(config.vies.mode)));
      let existing = await centers.findByVatNumber(vatNumber);
      if (!existing) {
        const { centerId } = await commands.execute(
          new RegisterTrainingCenterCommand(
            admin,
            center.name,
            center.country,
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
      if (existing && center.admin && !(await users.findByEmail(center.admin))) {
        await commands.execute(
          new CreateCenterUserCommand(admin, existing.id, center.admin, DEMO_PASSWORD),
        );
        log(`center admin ${center.admin}`);
      }
      // Programs are created and published together, only once the center can publish: a run that
      // stopped between the two would leave drafts the next run does not see, and duplicate them.
      if (center.programs.length === 0) {
        continue;
      }
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

    // The demo center posts its events to the compose webhook sink.
    const codeworks = await centers.findByVatNumber(
      unwrap(VatNumber.create(CENTERS[0].country, CENTERS[0].taxId(config.vies.mode))),
    );
    const subscriptions = app.get<WebhookSubscriptionRepository>(WEBHOOK_SUBSCRIPTION_REPOSITORY, {
      strict: false,
    });
    const codeworksAdmin = await users.findByEmail(CENTERS[0].admin);
    if (codeworks && codeworksAdmin && !(await subscriptions.findByCenter(codeworks.id))) {
      const webhook = await commands.execute(
        new ConfigureWebhookCommand(
          {
            kind: 'user',
            userId: codeworksAdmin.id,
            roles: ['center_admin'],
            centerId: codeworks.id,
          },
          codeworks.id,
          WEBHOOK_URL,
        ),
      );
      // Shown once, as the API does: the sink does not check it, a center would.
      log(`webhook of ${CENTERS[0].name} -> ${WEBHOOK_URL} (signing secret ${webhook.secret})`);
    }

    // Students, each with the applications of their scenario. The verification saga runs here
    // directly, as the worker would; the simulated providers answer from the national id.
    const applications = app.get<ApplicationQueries>(APPLICATION_QUERIES, { strict: false });
    const programIds = new Map<string, string>();
    for (const center of CENTERS) {
      const found = await centers.findByVatNumber(
        unwrap(VatNumber.create(center.country, center.taxId(config.vies.mode))),
      );
      const published = found
        ? (await catalog.list({ centerId: found.id }, { limit: 10 })).data
        : [];
      for (const program of published) programIds.set(program.name, program.id);
    }
    for (const student of STUDENTS) {
      const found = await users.findByEmail(student.email);
      const studentId =
        found?.id ??
        (await commands.execute(new RegisterStudentCommand(student.email, DEMO_PASSWORD))).userId;
      if (!found) log(`student ${student.email}`);
      const actor: Principal = {
        kind: 'user',
        userId: studentId,
        roles: ['student'],
        centerId: null,
      };
      const started =
        (await applications.list({ applicantId: studentId }, { limit: 1 })).data.length > 0;
      const ready = student.applications.every((item) => programIds.has(item.program));
      if (started || !ready) continue;
      for (const item of student.applications) {
        const outcome = await applyAndVerify(
          actor,
          programIds.get(item.program) ?? '',
          item.product,
          item.profile,
        );
        log(`application of ${student.email} for ${outcome}`);
      }
    }

    async function applyAndVerify(
      actor: Principal,
      programId: string,
      product: RequestedProductDto,
      profile: ProfileInput,
    ): Promise<string> {
      const draft = await commands.execute(
        new StartApplicationCommand(actor, { programId, product, profile }),
      );
      await commands.execute(new SubmitApplicationCommand(actor, draft.id));
      for (const type of ['kyc', 'employment', 'bureau'] as const) {
        await commands.execute(new RunVerificationCommand(draft.id, type));
      }
      await commands.execute(new ScoreApplicationCommand(draft.id));
      const result = await app.get(QueryBus).execute(new GetApplicationQuery(actor, draft.id));
      return `${draft.programName}: ${result.status}`;
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
