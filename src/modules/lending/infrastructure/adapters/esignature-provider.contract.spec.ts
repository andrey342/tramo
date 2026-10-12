import { esignatureProviderContract } from '../../../../../test/contracts/esignature-provider.contract';
import { FakeESignatureProvider } from '../../../../../test/fakes/lending';

import { SimulatedESignatureProvider } from './simulated-esignature-provider';

esignatureProviderContract('FakeESignatureProvider', () => new FakeESignatureProvider());
esignatureProviderContract('SimulatedESignatureProvider', () => new SimulatedESignatureProvider());
