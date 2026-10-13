import { uuidv7 } from 'uuidv7';

import { type CenterDirectory } from '../../src/modules/iam/application/ports/iam-ports';

export interface CenterDirectoryHarness {
  readonly directory: CenterDirectory;
  // A center the directory knows about, not suspended.
  readonly existingCenterId: string;
  // A center Tramo has suspended.
  readonly suspendedCenterId: string;
}

// The fake used by iam's unit tests and the adapter that asks the catalog module agree.
export function centerDirectoryContract(
  name: string,
  create: () => Promise<CenterDirectoryHarness> | CenterDirectoryHarness,
): void {
  describe(`${name} (CenterDirectory contract)`, () => {
    it('should know a registered center and no other', async () => {
      const { directory, existingCenterId } = await create();

      expect(await directory.find(existingCenterId)).toEqual({ suspended: false });
      expect(await directory.find(uuidv7())).toBeNull();
    });

    it('should tell when a center is suspended', async () => {
      const { directory, suspendedCenterId } = await create();

      expect(await directory.find(suspendedCenterId)).toEqual({ suspended: true });
    });
  });
}
