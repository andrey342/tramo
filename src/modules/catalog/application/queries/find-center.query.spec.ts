import { aTrainingCenter } from '../../../../../test/factories/catalog';
import { InMemoryTrainingCenterRepository } from '../../../../../test/fakes/catalog';
import { RecordingEventBus } from '../../../../../test/fakes/shared';
import { FindCenterQuery, GetPayoutAccountQuery } from '../dto/center-lookup';

import { FindCenterHandler, GetPayoutAccountHandler } from './find-center.query';

describe('FindCenter', () => {
  it('should summarise a known center and answer null for an unknown one', async () => {
    const centers = new InMemoryTrainingCenterRepository(new RecordingEventBus());
    const center = aTrainingCenter({ name: 'Codeworks Madrid' });
    await centers.save(center);
    const handler = new FindCenterHandler(centers);

    expect(await handler.execute(new FindCenterQuery(center.id))).toEqual({
      id: center.id,
      name: 'Codeworks Madrid',
      status: 'pending_verification',
      platformFeeBasisPoints: center.platformFee.basisPoints,
    });
    expect(await handler.execute(new FindCenterQuery('missing'))).toBeNull();
  });
});

describe('GetPayoutAccount', () => {
  it('should give the full payout IBAN of a known center and null for an unknown one', async () => {
    const centers = new InMemoryTrainingCenterRepository(new RecordingEventBus());
    const center = aTrainingCenter({ name: 'Codeworks Madrid' });
    await centers.save(center);
    const handler = new GetPayoutAccountHandler(centers);

    expect(await handler.execute(new GetPayoutAccountQuery(center.id))).toEqual({
      centerId: center.id,
      holderName: 'Codeworks Madrid',
      iban: center.payoutIban.value,
      centerStatus: 'pending_verification',
    });
    expect(await handler.execute(new GetPayoutAccountQuery('missing'))).toBeNull();
  });
});
