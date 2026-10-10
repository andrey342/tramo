import { Global, Module } from '@nestjs/common';

import { FieldCipher } from './field-cipher';

export { FieldCipher, FieldDecryptionError } from './field-cipher';

@Global()
@Module({ providers: [FieldCipher], exports: [FieldCipher] })
export class CryptoModule {}
