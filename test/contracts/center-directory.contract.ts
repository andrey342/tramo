import { uuidv7 } from 'uuidv7';

import { type CenterDirectory } from '../../src/modules/iam/application/ports/iam-ports';

export interface CenterDirectoryHarness {
  readonly directory: CenterDirectory;
  // A center the directory knows about.
  readonly existingCenterId: string;
}

// The fake used by iam's unit tests and the adapter that asks the catalog module agree.
export function centerDirectoryContract(
  name: string,
  create: () => Promise<CenterDirectoryHarness> | CenterDirectoryHarness,
): void {
  describe(`${name} (CenterDirectory contract)`, () => {
    it('should know a registered center and no other', async () => {
      const { directory, existingCenterId } = await create();

      expect(await directory.exists(existingCenterId)).toBe(true);
      expect(await directory.exists(uuidv7())).toBe(false);
    });
  });
}
