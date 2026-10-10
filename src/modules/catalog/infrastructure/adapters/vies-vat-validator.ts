import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleType,
  type IPolicy,
  isBrokenCircuitError,
  isTaskCancelledError,
  retry,
  TaskCancelledError,
  timeout,
  TimeoutStrategy,
  wrap,
} from 'cockatiel';

import { type VatNumber } from '@shared/domain';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { type VatValidator } from '../../application/ports/catalog-ports';
import { type VatCheckResult } from '../../domain';

const PROVIDER = 'vies';

// VIES answers HTTP 200 with `actionSucceed: false` when it cannot decide. These codes mean "ask
// again later"; anything else is a refusal that retrying will not change.
const TRANSIENT_ERRORS = new Set([
  'SERVICE_UNAVAILABLE',
  'MS_UNAVAILABLE',
  'TIMEOUT',
  'GLOBAL_MAX_CONCURRENT_REQ',
  'GLOBAL_MAX_CONCURRENT_REQ_TIME',
  'MS_MAX_CONCURRENT_REQ',
  'MS_MAX_CONCURRENT_REQ_TIME',
]);

class ViesTransientError extends Error {
  constructor(readonly reason: string) {
    super(`VIES could not answer: ${reason}`);
    this.name = 'ViesTransientError';
  }
}

interface ViesResponse {
  valid?: boolean;
  name?: string;
  actionSucceed?: boolean;
  errorWrappers?: { error?: string }[];
}

// Client for the European Commission's VIES REST API (no API key). `VIES_MODE=test` points it at
// the test service, which answers by number (100 valid, 200 invalid, 300 down).
//
// Resilience, from the outside in:
// - retry: two more attempts with exponential backoff, only for transient failures and timeouts
//   (the check is a read, so repeating it is safe);
// - circuit breaker: after five failed calls in a row, stop calling for 30 s and answer
//   `unavailable` at once, so a VIES outage does not hold requests and queue workers (a VIES that
//   hangs counts as failing: timeouts open the circuit too);
// - timeout: each attempt is cancelled after VIES_TIMEOUT_MS.
// Whatever is left becomes `unavailable`: a registry outage never fails the caller.
@Injectable()
export class ViesVatValidator implements VatValidator {
  private readonly logger = new Logger(ViesVatValidator.name);
  private readonly endpoint: string;
  private readonly policy: IPolicy;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const path = config.vies.mode === 'test' ? 'check-vat-test-service' : 'check-vat-number';
    this.endpoint = `${config.vies.baseUrl.replace(/\/$/, '')}/${path}`;
    // cockatiel rethrows what a policy does not handle, so the timeout error has to be named here
    // for retries and the breaker to see it.
    const transient = handleType(ViesTransientError).orType(TaskCancelledError);
    this.policy = wrap(
      retry(transient, {
        maxAttempts: 2,
        backoff: new ExponentialBackoff({ initialDelay: 200, maxDelay: 2_000 }),
      }),
      circuitBreaker(transient, { halfOpenAfter: 30_000, breaker: new ConsecutiveBreaker(5) }),
      timeout(config.vies.timeoutMs, TimeoutStrategy.Aggressive),
    );
  }

  async check(vatNumber: VatNumber): Promise<VatCheckResult> {
    try {
      return await this.policy.execute(({ signal }) => this.request(vatNumber, signal));
    } catch (error) {
      const reason = isBrokenCircuitError(error)
        ? 'CIRCUIT_OPEN'
        : isTaskCancelledError(error)
          ? 'TIMEOUT'
          : error instanceof ViesTransientError
            ? error.reason
            : 'UNEXPECTED_ERROR';
      this.logger.warn({ country: vatNumber.country, reason }, 'VIES check unavailable');
      return { outcome: 'unavailable', provider: PROVIDER, reason };
    }
  }

  private async request(vatNumber: VatNumber, signal: AbortSignal): Promise<VatCheckResult> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ countryCode: vatNumber.country, vatNumber: vatNumber.number }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ViesTransientError('NETWORK_ERROR');
    }
    if (response.status >= 500 || response.status === 429) {
      throw new ViesTransientError(`HTTP_${String(response.status)}`);
    }
    const body = (await response.json().catch(() => ({}))) as ViesResponse;
    if (body.actionSucceed === false) {
      const code = body.errorWrappers?.[0]?.error ?? 'UNKNOWN';
      if (TRANSIENT_ERRORS.has(code)) {
        throw new ViesTransientError(code);
      }
      // A malformed number is a verdict; other refusals (blocked requester...) are not.
      return code === 'INVALID_INPUT'
        ? { outcome: 'invalid', provider: PROVIDER }
        : { outcome: 'unavailable', provider: PROVIDER, reason: code };
    }
    if (typeof body.valid !== 'boolean') {
      throw new ViesTransientError(`HTTP_${String(response.status)}_UNEXPECTED_BODY`);
    }
    return body.valid
      ? { outcome: 'valid', provider: PROVIDER, registeredName: registeredName(body.name) }
      : { outcome: 'invalid', provider: PROVIDER };
  }
}

// VIES writes "---" when a member state does not disclose the name.
function registeredName(name: string | undefined): string | null {
  const trimmed = name?.trim();
  return trimmed && trimmed !== '---' ? trimmed.slice(0, 200) : null;
}
