import { Injectable } from '@nestjs/common';

import {
  type EnvelopeRequest,
  type ESignatureProvider,
} from '../../application/ports/lending-ports';

// Stands in for a provider such as DocuSign or Signaturit: it accepts the envelope and nothing
// else happens until someone posts the signed callback to POST /webhooks/esign (the demo does,
// with `pnpm esign:sign <contractId>`). The envelope id derives from the contract, so sending a
// contract twice gives the same envelope, as a provider's idempotency key would.
@Injectable()
export class SimulatedESignatureProvider implements ESignatureProvider {
  readonly name = 'simulated';

  sendEnvelope(request: EnvelopeRequest): Promise<{ readonly envelopeId: string }> {
    return Promise.resolve({ envelopeId: simulatedEnvelopeId(request.contractId) });
  }
}

export const simulatedEnvelopeId = (contractId: string): string => `sim-env-${contractId}`;
