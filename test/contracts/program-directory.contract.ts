import { type ProgramDirectory } from '../../src/modules/origination/application/ports/origination-ports';

export interface ProgramDirectoryHarness {
  readonly directory: ProgramDirectory;
  // A published program of an active center, offering instalments over 12 and 24 months and
  // an ISA, priced at 7,500 EUR.
  readonly openProgramId: string;
  // A program that exists but is not open for applications (a draft).
  readonly closedProgramId: string;
}

// The fake of unit tests and the adapter that asks catalog agree on what a snapshot holds.
export function programDirectoryContract(
  name: string,
  create: () => Promise<ProgramDirectoryHarness> | ProgramDirectoryHarness,
): void {
  describe(`${name} (ProgramDirectory contract)`, () => {
    it('should snapshot an open program with its price and financing options', async () => {
      const { directory, openProgramId } = await create();

      const program = await directory.findOpenProgram(openProgramId);

      expect(program?.programId).toBe(openProgramId);
      expect(program?.price.cents).toBe(7_500_00);
      expect(program?.installments?.allowedTerms).toEqual([12, 24]);
      expect(program?.isa?.capMultiplierHundredths).toBeGreaterThanOrEqual(100);
    });

    it('should find nothing for a closed or unknown program', async () => {
      const { directory, closedProgramId } = await create();

      expect(await directory.findOpenProgram(closedProgramId)).toBeNull();
      expect(await directory.findOpenProgram('0199a000-0000-7000-8000-0000000000ff')).toBeNull();
    });
  });
}
