import { type ContractingDirectory } from '../../src/modules/lending/application/ports/lending-ports';

export interface ContractingDirectoryHarness {
  readonly directory: ContractingDirectory;
  // An active center charging a 5 % platform fee, with a 12 week program.
  readonly centerId: string;
  readonly programId: string;
  readonly payoutIban: string;
  // A program of another center, and a suspended center.
  readonly otherCenterProgramId: string;
  readonly suspendedCenterId: string;
}

const UNKNOWN = '0199a000-0000-7000-8000-0000000000ff';

// The fake of unit tests and the adapter that asks catalog agree on what lending reads.
export function contractingDirectoryContract(
  name: string,
  create: () => Promise<ContractingDirectoryHarness> | ContractingDirectoryHarness,
): void {
  describe(`${name} (ContractingDirectory contract)`, () => {
    it("should give the center's platform fee and the program's length", async () => {
      const { directory, centerId, programId } = await create();

      const details = await directory.contractingDetails(centerId, programId);

      expect(details?.platformFee.basisPoints).toBe(500);
      expect(details?.programDurationWeeks).toBe(12);
    });

    it('should know nothing of a program of another center or of unknown ids', async () => {
      const { directory, centerId, programId, otherCenterProgramId } = await create();

      expect(await directory.contractingDetails(centerId, otherCenterProgramId)).toBeNull();
      expect(await directory.contractingDetails(UNKNOWN, programId)).toBeNull();
      expect(await directory.contractingDetails(centerId, UNKNOWN)).toBeNull();
    });

    it('should give the full payout account and whether the center is active', async () => {
      const { directory, centerId, payoutIban, suspendedCenterId } = await create();

      expect(await directory.payoutAccount(centerId)).toEqual({
        iban: payoutIban,
        holderName: expect.any(String),
        centerActive: true,
      });
      expect((await directory.payoutAccount(suspendedCenterId))?.centerActive).toBe(false);
      expect(await directory.payoutAccount(UNKNOWN)).toBeNull();
    });
  });
}
