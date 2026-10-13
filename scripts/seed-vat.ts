// VAT numbers of the seeded centers and how the seed rides out a registry that cannot answer.

// The VIES test service answers 100 as valid and 200 as invalid in every country, so in `test`
// mode each active center has 100 in its own country; `fake` (the compose default, offline)
// accepts the realistic numbers and refuses 200 as well.
const testOr = (realistic: string) => (mode: string) => (mode === 'test' ? '100' : realistic);

export const SEED_TAX_IDS = {
  codeworks: testOr('B66079911'),
  berlin: testOr('DE811569869'),
  // Refused in every mode: the demo's center left pending with an invalid number.
  nova: (_mode: string) => '200',
} as const;

// Waits between VAT checks of a center the registry could not answer for. The VIES client
// already retries each check twice; these cover a slightly longer hiccup.
export const VAT_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000];

// Still pending with no verdict: the registry did not answer (an invalid number is a verdict).
export function awaitingVat(center: {
  readonly status: string;
  readonly vatValidation: { readonly status: string } | null;
}): boolean {
  return center.status === 'pending_verification' && center.vatValidation?.status !== 'invalid';
}

export interface RetryOptions<T> {
  // One delay per extra attempt: [1_000, 2_000] means three attempts in total.
  readonly delaysMs: readonly number[];
  readonly onRetry?: (result: T, attempt: number, delayMs: number) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

// Runs again after each delay while the result is undecided, and returns the last result
// whatever it is, so the caller decides what an answer that never came means.
export async function retryWhile<T>(
  run: () => Promise<T>,
  undecided: (result: T) => boolean,
  options: RetryOptions<T>,
): Promise<T> {
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let result = await run();
  for (const [index, delayMs] of options.delaysMs.entries()) {
    if (!undecided(result)) break;
    options.onRetry?.(result, index + 1, delayMs);
    await sleep(delayMs);
    result = await run();
  }
  return result;
}
