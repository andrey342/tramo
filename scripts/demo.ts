// Walks the happy path against a running stack and prints each step: a new student applies for
// the bootcamp, is verified and scored by the worker, accepts the offer and signs; the center is
// paid; billing collects the first instalment through the simulated payment provider; and the
// statement and the center's dashboard show it.
//   pnpm demo                                    (from the host, after `docker compose up`)
//   docker compose exec api node dist/scripts/demo.js   (nothing installed on the host)
// Needs the seed (`pnpm seed`, or the compose `seed` service). Local stacks only: it plays the
// e-signature provider with the webhook secret.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { signWebhook } from '../src/shared/infrastructure/http/webhook-signature';

import { DEMO_PASSWORD, DEMO_USERS } from './demo-users';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'api']);
const PROGRAM = 'Full Stack Web Development Bootcamp';
// Verified, 19 months of work on record and an affordable payment: approved (see the README).
const PROFILE = {
  dateOfBirth: '1998-05-20',
  nationalId: '56781234F',
  residenceCountry: 'ES',
  declaredMonthlyIncomeCents: 1_800_00,
  employmentStatus: 'employed',
};
const STUDENT_IBAN = 'ES7620770024003102575766';

type Json = Record<string, unknown>;

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
const apiUrl = process.env['API_URL'] ?? 'http://localhost:3000';
const mailpitUrl = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';
const sinkUrl = process.env['WEBHOOK_SINK_URL'] ?? 'http://localhost:9099';
const base = `${apiUrl}/api/v1`;

let step = 0;
const say = (text: string): void => {
  step += 1;
  process.stdout.write(`\n${String(step).padStart(2)}. ${text}\n`);
};
const detail = (text: string): void => {
  process.stdout.write(`    ${text}\n`);
};
const euros = (cents: number): string =>
  `${(cents / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })} EUR`;

async function call<T = Json>(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; idempotent?: boolean; raw?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`;
  if (options.idempotent) headers['Idempotency-Key'] = randomUUID();
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} answered ${String(response.status)}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

async function signIn(email: string): Promise<string> {
  const { accessToken } = await call<{ accessToken: string }>('POST', '/auth/login', {
    body: { email, password: DEMO_PASSWORD },
  });
  return accessToken;
}

// The worker does the next step on its own; this waits for it, up to a minute.
async function until<T>(what: string, read: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`gave up waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main(): Promise<void> {
  const esignSecret = process.env['ESIGN_WEBHOOK_SECRET'];
  if (process.env['NODE_ENV'] === 'production' || !LOCAL_HOSTS.has(new URL(apiUrl).hostname)) {
    throw new Error(`Refusing to run against ${apiUrl}: the demo is for a local stack only.`);
  }
  if (!esignSecret) {
    throw new Error('ESIGN_WEBHOOK_SECRET is not set (copy .env.example to .env).');
  }
  process.stdout.write(`Tramo demo against ${apiUrl}\n`);

  const email = `demo-${randomUUID().slice(0, 8)}@example.com`;
  say(`A new student registers and signs in: ${email}`);
  await call('POST', '/auth/register', { body: { email, password: DEMO_PASSWORD } });
  const student = await signIn(email);

  say('The student browses the public catalog');
  const catalog = await call<{ data: Json[] }>('GET', '/programs?limit=50');
  const program = catalog.data.find((item) => item['name'] === PROGRAM);
  if (!program) throw new Error(`"${PROGRAM}" is not published; run the seed first.`);
  detail(
    `${String(catalog.data.length)} programs; picks "${PROGRAM}" at ${String(program['centerName'])}`,
  );
  detail(`price ${euros(Number(program['priceCents']))}`);

  say('Applies for 24 monthly instalments and submits');
  const draft = await call('POST', '/applications', {
    token: student,
    idempotent: true,
    body: {
      programId: program['id'],
      product: { kind: 'installments', termMonths: 24 },
      profile: PROFILE,
    },
  });
  const applicationId = String(draft['id']);
  await call('POST', `/applications/${applicationId}/submit`, { token: student, idempotent: true });
  detail(`application ${applicationId}: submitted`);

  say('The worker checks identity, employment and the credit bureau, then scores');
  const decided = await until('the decision', async () => {
    const application = await call('GET', `/applications/${applicationId}`, {
      token: student,
    });
    return ['approved', 'rejected', 'needs_review'].includes(String(application['status']))
      ? application
      : null;
  });
  detail(`status ${String(decided['status'])}, score ${String(decided['score'])}`);
  if (decided['status'] !== 'approved') throw new Error('the demo profile was not approved');
  const offer = decided['terms'] as Json;
  detail(
    `offer: ${String(offer['termMonths'])} x ${euros(Number(offer['monthlyPaymentCents']))}, ` +
      `APR ${(Number(offer['aprBasisPoints']) / 100).toFixed(2)} %`,
  );
  const decision = await call('GET', `/applications/${applicationId}/decision`, {
    token: student,
  });
  for (const factor of decision['factors'] as Json[]) {
    detail(`  ${String(factor['name']).padEnd(18)} ${String(factor['points']).padStart(6)} points`);
  }
  for (const reason of decision['reasons'] as string[]) detail(`  ${reason}`);

  say('The student accepts the offer; the worker draws up the contract and sends it to sign');
  await call('POST', `/applications/${applicationId}/accept-offer`, {
    token: student,
    idempotent: true,
  });
  const contract = await until('the contract', async () => {
    const page = await call<{ data: Json[] }>('GET', '/contracts', { token: student });
    const found = page.data.find((item) => item['applicationId'] === applicationId);
    if (!found) return null;
    const full = await call('GET', `/contracts/${String(found['id'])}`, { token: student });
    return full['status'] === 'sent_for_signature' ? full : null;
  });
  const contractId = String(contract['id']);
  const signature = contract['signature'] as Json;
  detail(
    `contract ${contractId}: sent for signature (envelope ${String(signature['envelopeId'])})`,
  );

  say('The student signs; the e-signature provider calls back (signed with its secret)');
  const document = await fetch(`${base}/contracts/${contractId}/document`, {
    headers: { Authorization: `Bearer ${student}` },
  }).then((response) => response.text());
  const callback = JSON.stringify({
    eventId: randomUUID(),
    type: 'envelope.completed',
    envelopeId: signature['envelopeId'],
    documentHash: createHash('sha256').update(document).digest('hex'),
    occurredAt: new Date().toISOString(),
  });
  const signed = await fetch(`${base}/webhooks/esign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Esign-Signature': signWebhook(esignSecret, callback, new Date()),
    },
    body: callback,
  });
  detail(`callback answered ${String(signed.status)}`);

  say('The student authorises the direct debit of the instalments');
  const mandate = await call('POST', `/contracts/${contractId}/mandate`, {
    token: student,
    idempotent: true,
    body: { iban: STUDENT_IBAN },
  });
  detail(`mandate ${String(mandate['reference'])} on ${String(mandate['ibanMasked'])}`);

  say('The worker pays the center (minus the platform fee) and the contract becomes active');
  const active = await until('the payout', async () => {
    const current = await call('GET', `/contracts/${contractId}`, { token: student });
    return current['status'] === 'active' ? current : null;
  });
  const centerAdmin = await signIn(DEMO_USERS.center);
  const asCenter = await call('GET', `/contracts/${contractId}`, { token: centerAdmin });
  const payout = asCenter['payout'] as Json;
  const centerId = String(asCenter['centerId']);
  const before = await call('GET', `/centers/${centerId}/dashboard`, { token: centerAdmin });
  const collectedBefore = Number(before['collectedCents']);
  detail(
    `disbursed ${euros(Number(payout['disbursementAmountCents']))} to the center ` +
      `(${String(payout['disbursementStatus'])}); active on ${String(active['activatedOn'])}`,
  );

  // The plan is opened by the worker once the contract is active.
  const schedule = await until('the repayment plan', async () => {
    try {
      return await call<{ installments: Json[] }>('GET', `/contracts/${contractId}/schedule`, {
        token: student,
      });
    } catch {
      return null;
    }
  });
  const first = schedule.installments[0];
  if (!first) throw new Error('the contract has no schedule');
  say(`Operations run billing as of the first due date, ${String(first['dueDate'])}`);
  const ops = await signIn(DEMO_USERS.ops);
  const run = await call(
    'POST',
    `/ops/billing/run?asOf=${String(first['dueDate'])}&contractId=${contractId}`,
    { token: ops, idempotent: true },
  );
  detail(
    `${String(run['chargesCreated'])} charge created, ${String(run['collectionsSubmitted'])} sent ` +
      'to the payment provider',
  );

  say('The simulated payment provider collects and calls back');
  const paid = await until('the payment', async () => {
    const page = await call<{ data: Json[] }>('GET', `/contracts/${contractId}/charges`, {
      token: student,
    });
    const charge = page.data.find((item) => item['installmentNumber'] === 1);
    return charge?.['status'] === 'paid' ? charge : null;
  });
  detail(`instalment 1: ${euros(Number(paid['amountCents']))} paid`);

  say("The student's statement");
  // The ledger records the payment from the charge's event, a moment after the charge.
  const statement = await until('the payment in the ledger', async () => {
    const current = await call('GET', `/contracts/${contractId}/statement`, {
      token: student,
    });
    const entries = current['entries'] as Json[];
    return entries.some((entry) => entry['type'] === 'payment') ? current : null;
  });
  for (const entry of statement['entries'] as Json[]) {
    detail(
      `${String(entry['type']).padEnd(9)} ${euros(Number(entry['amountCents'])).padStart(14)}  ` +
        String(entry['description']),
    );
  }
  detail(`balance owed now: ${euros(Number(statement['balanceCents']))}`);

  say("The center's dashboard (read model, filled by the events)");
  const dashboard = await until('the dashboard', async () => {
    const current = await call('GET', `/centers/${centerId}/dashboard`, {
      token: centerAdmin,
    });
    return Number(current['collectedCents']) >= collectedBefore + Number(paid['amountCents'])
      ? current
      : null;
  });
  const contracts = dashboard['contracts'] as Json;
  detail(
    `contracts active ${String(contracts['active'])}, disbursed ` +
      `${euros(Number(dashboard['disbursedCents']))}, collected ` +
      `${euros(Number(dashboard['collectedCents']))}, outstanding ` +
      euros(Number(dashboard['outstandingCents'])),
  );

  say('What left the system');
  try {
    const mail = (await fetch(
      `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    ).then((response) => response.json())) as { messages_count?: number; messages?: Json[] };
    detail(`${String(mail.messages_count ?? 0)} emails to ${email} in Mailpit (${mailpitUrl}):`);
    for (const message of mail.messages ?? []) detail(`  ${String(message['Subject'])}`);
  } catch {
    detail(`emails: see Mailpit at ${mailpitUrl}`);
  }
  try {
    const sink = (await fetch(`${sinkUrl}/deliveries`).then((response) => response.json())) as {
      data: Json[];
    };
    const ours = sink.data.filter((delivery) => JSON.stringify(delivery).includes(contractId));
    detail(`${String(ours.length)} signed webhooks about this contract at the sink (${sinkUrl}):`);
    for (const delivery of ours) detail(`  ${String(delivery['event'])}`);
  } catch {
    detail(`webhooks: see the sink at ${sinkUrl}/deliveries`);
  }
  process.stdout.write('\nDone.\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `\ndemo failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
