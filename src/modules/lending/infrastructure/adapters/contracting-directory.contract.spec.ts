import { uuidv7 } from 'uuidv7';

import { contractingDirectoryContract } from '../../../../../test/contracts/contracting-directory.contract';
import { FakeContractingDirectory, OPEN_IBAN } from '../../../../../test/fakes/lending';

contractingDirectoryContract('FakeContractingDirectory', () => {
  const [centerId, otherCenterId, suspendedCenterId] = [uuidv7(), uuidv7(), uuidv7()];
  const [programId, otherCenterProgramId] = [uuidv7(), uuidv7()];
  const directory = new FakeContractingDirectory()
    .addCenter(centerId)
    .addCenter(otherCenterId)
    .addCenter(suspendedCenterId, { active: false })
    .addProgram(programId, centerId, 12)
    .addProgram(otherCenterProgramId, otherCenterId);
  return {
    directory,
    centerId,
    programId,
    payoutIban: OPEN_IBAN,
    otherCenterProgramId,
    suspendedCenterId,
  };
});
