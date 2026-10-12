import { bankTransferProviderContract } from '../../../../../test/contracts/bank-transfer-provider.contract';
import {
  CLOSED_IBAN,
  FakeBankTransferProvider,
  OPEN_IBAN,
} from '../../../../../test/fakes/lending';

import { SimulatedBankTransferProvider } from './simulated-bank-transfer-provider';

bankTransferProviderContract('FakeBankTransferProvider', () => ({
  provider: new FakeBankTransferProvider(),
  openIban: OPEN_IBAN,
  closedIban: CLOSED_IBAN,
}));
bankTransferProviderContract('SimulatedBankTransferProvider', () => ({
  provider: new SimulatedBankTransferProvider(),
  openIban: OPEN_IBAN,
  closedIban: CLOSED_IBAN,
}));
