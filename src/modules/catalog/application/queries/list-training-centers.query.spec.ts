import { type Principal } from '@shared/application';

import { CenterAccessDeniedError } from '../../domain';
import { type TrainingCenterQueries } from '../ports/catalog-ports';

import {
  ListTrainingCentersHandler,
  ListTrainingCentersQuery,
} from './list-training-centers.query';

const user = (role: string): Principal =>
  ({ kind: 'user', userId: 'u-1', roles: [role], centerId: null }) as Principal;

describe('ListTrainingCenters', () => {
  const asked: unknown[] = [];
  const centers: TrainingCenterQueries = {
    list: (filter, page) => {
      asked.push({ filter, page });
      return Promise.resolve({ data: [], nextCursor: null });
    },
  };
  const handler = new ListTrainingCentersHandler(centers);

  it('should list for staff, by status when asked', async () => {
    await handler.execute(
      new ListTrainingCentersQuery(user('ops'), 'pending_verification', { limit: 20 }),
    );
    await handler.execute(new ListTrainingCentersQuery(user('admin'), null, { limit: 5 }));

    expect(asked).toEqual([
      { filter: { status: 'pending_verification' }, page: { limit: 20 } },
      { filter: {}, page: { limit: 5 } },
    ]);
  });

  it('should refuse a center admin', () => {
    expect(() =>
      handler.execute(new ListTrainingCentersQuery(user('center_admin'), null, { limit: 20 })),
    ).toThrow(CenterAccessDeniedError);
  });
});
