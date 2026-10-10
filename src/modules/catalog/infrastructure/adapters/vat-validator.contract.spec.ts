import { vatValidatorContract } from '../../../../../test/contracts/vat-validator.contract';

import { FakeVatValidator } from './fake-vat-validator';

vatValidatorContract('FakeVatValidator', () => new FakeVatValidator());
