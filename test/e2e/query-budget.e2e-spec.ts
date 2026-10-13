import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { registerCenter } from '../helpers/centers';
import { createApiApp } from '../helpers/create-api-app';
import { publishProgram } from '../helpers/programs';
import { countQueries } from '../helpers/query-counter';
import { accessTokenFor, createStaffUser, registerStudent } from '../helpers/users';

// A list costs the same number of statements whatever the size of its page: no query per row.
describe('Query budget of lists (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    app = await createApiApp();
    adminToken = await accessTokenFor(app, await createStaffUser(app, 'admin'));
  });

  afterAll(async () => {
    await app.close();
  });

  // A center with `count` published programs; returns the center and its programs.
  async function centerWithPrograms(count: number): Promise<{ centerId: string; ids: string[] }> {
    const centerId = await registerCenter(app, adminToken);
    const ids: string[] = [];
    for (let n = 0; n < count; n += 1) {
      ids.push(await publishProgram(app, adminToken, centerId, `Bootcamp ${String(n)}`));
    }
    return { centerId, ids };
  }

  async function studentWithApplications(programIds: readonly string[]): Promise<string> {
    const token = await registerStudent(app);
    for (const programId of programIds) {
      await api()
        .post('/api/v1/applications')
        .set(...bearer(token))
        .set('Idempotency-Key', uuidv7())
        .send({ programId, product: { kind: 'installments', termMonths: 12 } })
        .expect(201);
    }
    return token;
  }

  it('should list the catalog, center names included, in the same statements for 1 or 4 rows', async () => {
    const one = await centerWithPrograms(1);
    const four = await centerWithPrograms(4);
    const list = (centerId: string, rows: number) => async () => {
      const page = await api().get(`/api/v1/programs?centerId=${centerId}`).expect(200);
      expect((page.body as { data: unknown[] }).data).toHaveLength(rows);
    };

    const forOne = await countQueries(list(one.centerId, 1));
    const forFour = await countQueries(list(four.centerId, 4));
    const wholeCatalog = await countQueries(async () => {
      await api().get('/api/v1/programs?limit=50').expect(200);
    });

    expect(forOne).toBeGreaterThan(0);
    expect(forFour).toBe(forOne);
    expect(wholeCatalog).toBe(forOne);
  });

  it('should list a student their applications in the same statements for 1 or 4 rows', async () => {
    const { ids } = await centerWithPrograms(4);
    const oneToken = await studentWithApplications(ids.slice(0, 1));
    const fourToken = await studentWithApplications(ids);
    const list = (token: string, rows: number) => async () => {
      const page = await api()
        .get('/api/v1/applications')
        .set(...bearer(token))
        .expect(200);
      expect((page.body as { data: unknown[] }).data).toHaveLength(rows);
    };

    const forOne = await countQueries(list(oneToken, 1));
    const forFour = await countQueries(list(fourToken, 4));

    expect(forOne).toBeGreaterThan(0);
    expect(forFour).toBe(forOne);
  });
});
