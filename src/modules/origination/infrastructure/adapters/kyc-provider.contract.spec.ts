import { kycProviderContract } from '../../../../../test/contracts/kyc-provider.contract';
import { FakeKycProvider } from '../../../../../test/fakes/origination';

import { SimulatedKycProvider } from './simulated-kyc-provider';
import { NO_LATENCY } from './simulated-providers';

kycProviderContract('FakeKycProvider', () => new FakeKycProvider());
kycProviderContract('SimulatedKycProvider', () => new SimulatedKycProvider(NO_LATENCY));
