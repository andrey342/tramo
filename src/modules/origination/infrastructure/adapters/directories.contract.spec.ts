import { Percentage } from '@shared/domain';

import { programDirectoryContract } from '../../../../../test/contracts/program-directory.contract';
import { studentDirectoryContract } from '../../../../../test/contracts/student-directory.contract';
import { aProgramSnapshot } from '../../../../../test/factories/origination';
import { FakeProgramDirectory, FakeStudentDirectory } from '../../../../../test/fakes/origination';

programDirectoryContract('FakeProgramDirectory', () => {
  const open = aProgramSnapshot({
    installments: { allowedTerms: [12, 24], annualRate: Percentage.fromPercent(7.5) },
  });
  const closed = aProgramSnapshot();
  const suspended = aProgramSnapshot();
  const directory = new FakeProgramDirectory([open, closed, suspended]);
  directory.close(closed.programId);
  directory.close(suspended.programId);
  return {
    directory,
    openProgramId: open.programId,
    closedProgramId: closed.programId,
    suspendedCenterProgramId: suspended.programId,
  };
});

studentDirectoryContract('FakeStudentDirectory', () => ({
  directory: new FakeStudentDirectory({ 'ana.garcia@example.com': 'student-ana' }),
  student: { email: 'ana.garcia@example.com', id: 'student-ana' },
  staffEmail: 'ops@tramo.test',
}));
