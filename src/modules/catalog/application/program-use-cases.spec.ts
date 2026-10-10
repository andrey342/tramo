import { ANONYMOUS, type Principal } from '@shared/application';
import {
  type ApiKeyScope,
  EntityNotFoundError,
  FixedClock,
  InvalidValueError,
} from '@shared/domain';

import { anActiveTrainingCenter, aTrainingCenter } from '../../../../test/factories/catalog';
import {
  InMemoryProgramCatalog,
  InMemoryProgramRepository,
  InMemoryTrainingCenterRepository,
} from '../../../../test/fakes/catalog';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import {
  CatalogEvents,
  CenterAccessDeniedError,
  InvalidFinancingOptionError,
  ProgramNotPublishableError,
  type TrainingCenter,
} from '../domain';

import { CreateProgramCommand, CreateProgramHandler } from './commands/create-program.command';
import { UpdateProgramCommand, UpdateProgramHandler } from './commands/update-program.command';
import { type FinancingInput, type ProgramDetailsInput } from './program-input';
import { GetProgramHandler, GetProgramQuery } from './queries/get-program.query';
import { ListProgramsHandler, ListProgramsQuery } from './queries/list-programs.query';

const DETAILS: ProgramDetailsInput = {
  name: 'Full Stack Bootcamp',
  modality: 'hybrid',
  priceCents: 7_500_00,
  durationWeeks: 16,
  startDates: ['2027-01-11'],
  employabilityRateBasisPoints: 8_500,
  avgStartingSalaryCents: 28_000_00,
};
const INSTALLMENTS: FinancingInput = {
  installments: { allowedTerms: [12, 24], annualRateBasisPoints: 750 },
};
const ISA: FinancingInput = {
  isa: {
    incomeShareBasisPoints: 1_000,
    minMonthlyIncomeCents: 1_500_00,
    maxPayments: 36,
    capMultiplierHundredths: 150,
    graceMonths: 3,
  },
};

const centerAdmin = (centerId: string): Principal => ({
  kind: 'user',
  userId: 'ca-1',
  roles: ['center_admin'],
  centerId,
});
const ADMIN: Principal = { kind: 'user', userId: 'a-1', roles: ['admin'], centerId: null };

function setup() {
  const clock = new FixedClock(new Date('2026-10-09T10:00:00Z'));
  const uow = new InlineUnitOfWork();
  const events = new RecordingEventBus();
  const centers = new InMemoryTrainingCenterRepository(events);
  const programs = new InMemoryProgramRepository(events);
  const catalog = new InMemoryProgramCatalog(programs, centers);
  return {
    events,
    centers,
    programs,
    create: new CreateProgramHandler(uow, programs, centers, clock),
    update: new UpdateProgramHandler(uow, programs, centers, clock),
    get: new GetProgramHandler(catalog, programs, centers),
    list: new ListProgramsHandler(catalog),
  };
}

async function withCenter(
  t: ReturnType<typeof setup>,
  center: TrainingCenter = anActiveTrainingCenter(),
) {
  await t.centers.save(center);
  return center;
}

describe('program use cases', () => {
  describe('CreateProgram', () => {
    it("should create a draft for the center's admin and for its API key", async () => {
      const t = setup();
      const center = await withCenter(t);
      const key: Principal = {
        kind: 'api_key',
        apiKeyId: 'k',
        centerId: center.id,
        scopes: ['programs:write'],
      };

      const byAdmin = await t.create.execute(
        new CreateProgramCommand(centerAdmin(center.id), center.id, DETAILS, INSTALLMENTS),
      );
      const byKey = await t.create.execute(new CreateProgramCommand(key, center.id, DETAILS, ISA));

      expect(byAdmin).toMatchObject({
        status: 'draft',
        priceCents: 750_000,
        products: ['installments'],
      });
      expect(byKey.financing.isa?.capMultiplierHundredths).toBe(150);
    });

    it('should refuse another center, a missing center and an ISA the numbers do not allow', async () => {
      const t = setup();
      const center = await withCenter(t);

      await expect(
        t.create.execute(
          new CreateProgramCommand(centerAdmin('other'), center.id, DETAILS, INSTALLMENTS),
        ),
      ).rejects.toThrow(CenterAccessDeniedError);
      await expect(
        t.create.execute(new CreateProgramCommand(ADMIN, 'missing', DETAILS, INSTALLMENTS)),
      ).rejects.toThrow(EntityNotFoundError);
      await expect(
        t.create.execute(
          new CreateProgramCommand(
            ADMIN,
            center.id,
            { ...DETAILS, employabilityRateBasisPoints: 5_000 },
            ISA,
          ),
        ),
      ).rejects.toThrow(InvalidFinancingOptionError);
    });
  });

  describe('UpdateProgram', () => {
    it('should apply new details and publish them in one go', async () => {
      const t = setup();
      const center = await withCenter(t);
      const draft = await t.create.execute(
        new CreateProgramCommand(ADMIN, center.id, DETAILS, INSTALLMENTS),
      );

      const published = await t.update.execute(
        new UpdateProgramCommand(centerAdmin(center.id), draft.id, {
          details: { priceCents: 6_900_00 },
          status: 'published',
        }),
      );

      expect(published).toMatchObject({ status: 'published', priceCents: 690_000 });
      expect(t.events.ofType(CatalogEvents.ProgramPublished)).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({ priceCents: 690_000 }) as object,
        }),
      ]);
    });

    it('should not publish while the center waits for verification', async () => {
      const t = setup();
      const center = await withCenter(t, aTrainingCenter());
      const draft = await t.create.execute(
        new CreateProgramCommand(ADMIN, center.id, DETAILS, INSTALLMENTS),
      );

      await expect(
        t.update.execute(new UpdateProgramCommand(ADMIN, draft.id, { status: 'published' })),
      ).rejects.toThrow(ProgramNotPublishableError);
    });

    it('should announce new financing of a published program and archive it', async () => {
      const t = setup();
      const center = await withCenter(t);
      const draft = await t.create.execute(
        new CreateProgramCommand(ADMIN, center.id, DETAILS, INSTALLMENTS),
      );
      await t.update.execute(new UpdateProgramCommand(ADMIN, draft.id, { status: 'published' }));

      await t.update.execute(
        new UpdateProgramCommand(ADMIN, draft.id, { financing: { ...INSTALLMENTS, ...ISA } }),
      );
      const archived = await t.update.execute(
        new UpdateProgramCommand(ADMIN, draft.id, { status: 'archived' }),
      );

      expect(t.events.ofType(CatalogEvents.ProgramFinancingChanged)).toHaveLength(1);
      expect(archived.status).toBe('archived');
    });

    it("should report another center's program as missing", async () => {
      const t = setup();
      const center = await withCenter(t);
      const draft = await t.create.execute(
        new CreateProgramCommand(ADMIN, center.id, DETAILS, INSTALLMENTS),
      );

      await expect(
        t.update.execute(
          new UpdateProgramCommand(centerAdmin('other'), draft.id, { status: 'archived' }),
        ),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('GetProgram and ListPrograms', () => {
    it('should show published programs to anyone and drafts only to their center', async () => {
      const t = setup();
      const center = await withCenter(t);
      const draft = await t.create.execute(
        new CreateProgramCommand(ADMIN, center.id, DETAILS, INSTALLMENTS),
      );
      const live = await t.create.execute(
        new CreateProgramCommand(ADMIN, center.id, DETAILS, INSTALLMENTS),
      );
      await t.update.execute(new UpdateProgramCommand(ADMIN, live.id, { status: 'published' }));

      expect((await t.get.execute(new GetProgramQuery(ANONYMOUS, live.id))).centerName).toBe(
        center.name,
      );
      await expect(t.get.execute(new GetProgramQuery(ANONYMOUS, draft.id))).rejects.toThrow(
        EntityNotFoundError,
      );
      expect(
        (await t.get.execute(new GetProgramQuery(centerAdmin(center.id), draft.id))).status,
      ).toBe('draft');
      await expect(t.get.execute(new GetProgramQuery(ADMIN, 'missing'))).rejects.toThrow(
        EntityNotFoundError,
      );
    });

    it("should show drafts to the center's API keys only when they may read programs", async () => {
      const t = setup();
      const center = await withCenter(t);
      const draft = await t.create.execute(
        new CreateProgramCommand(ADMIN, center.id, DETAILS, INSTALLMENTS),
      );
      const key = (scopes: ApiKeyScope[]): Principal => ({
        kind: 'api_key',
        apiKeyId: 'k',
        centerId: center.id,
        scopes,
      });

      await expect(
        t.get.execute(new GetProgramQuery(key(['applications:read']), draft.id)),
      ).rejects.toThrow(EntityNotFoundError);
      expect((await t.get.execute(new GetProgramQuery(key(['programs:read']), draft.id))).id).toBe(
        draft.id,
      );
      await expect(
        t.create.execute(
          new CreateProgramCommand(key(['programs:read']), center.id, DETAILS, INSTALLMENTS),
        ),
      ).rejects.toThrow(CenterAccessDeniedError);
    });

    it('should list the catalog and reject an inverted price range', async () => {
      const t = setup();
      const center = await withCenter(t);
      const live = await t.create.execute(
        new CreateProgramCommand(ADMIN, center.id, DETAILS, INSTALLMENTS),
      );
      await t.update.execute(new UpdateProgramCommand(ADMIN, live.id, { status: 'published' }));

      const page = await t.list.execute(
        new ListProgramsQuery({ product: 'installments' }, { limit: 10 }),
      );

      expect(page.data.map((program) => program.id)).toEqual([live.id]);
      expect(() =>
        t.list.execute(
          new ListProgramsQuery({ minPriceCents: 10, maxPriceCents: 5 }, { limit: 10 }),
        ),
      ).toThrow(InvalidValueError);
    });
  });
});
