import { type StudentDirectory } from '../../src/modules/origination/application/ports/origination-ports';

export interface StudentDirectoryHarness {
  readonly directory: StudentDirectory;
  readonly student: { readonly email: string; readonly id: string };
  // An account that exists but is not a student.
  readonly staffEmail: string;
}

export function studentDirectoryContract(
  name: string,
  create: () => Promise<StudentDirectoryHarness> | StudentDirectoryHarness,
): void {
  describe(`${name} (StudentDirectory contract)`, () => {
    it('should find a student by email, however it is written', async () => {
      const { directory, student } = await create();

      expect(await directory.findStudentId(` ${student.email.toUpperCase()} `)).toBe(student.id);
    });

    it('should find nobody for staff or an unknown email', async () => {
      const { directory, staffEmail } = await create();

      expect(await directory.findStudentId(staffEmail)).toBeNull();
      expect(await directory.findStudentId('nobody-at-all@example.com')).toBeNull();
    });
  });
}
