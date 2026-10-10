import { uuidv7 } from 'uuidv7';

import { centerDirectoryContract } from '../../../../../test/contracts/center-directory.contract';
import { FakeCenterDirectory } from '../../../../../test/fakes/iam';

centerDirectoryContract('FakeCenterDirectory', () => {
  const existingCenterId = uuidv7();
  return { directory: new FakeCenterDirectory(new Set([existingCenterId])), existingCenterId };
});
