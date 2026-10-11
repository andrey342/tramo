import { creditBureauContract } from '../../../../../test/contracts/credit-bureau.contract';
import { FakeCreditBureau } from '../../../../../test/fakes/origination';

import { SimulatedCreditBureau } from './simulated-credit-bureau';
import { NO_LATENCY } from './simulated-providers';

creditBureauContract('FakeCreditBureau', () => new FakeCreditBureau());
creditBureauContract('SimulatedCreditBureau', () => new SimulatedCreditBureau(NO_LATENCY));
