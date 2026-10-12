// Plays the e-signature provider for the demo: the student signs (or declines) a contract and the
// provider posts its signed callback to the api.
//   pnpm esign:sign <contractId> [--decline]
// Reads API_URL (default http://localhost:3000) and ESIGN_WEBHOOK_SECRET from .env, and looks the
// envelope up as the demo ops user. Local and demo use only.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { signWebhook } from '../src/shared/infrastructure/http/webhook-signature';

import { DEMO_PASSWORD, DEMO_USERS } from './demo-users';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'api']);

interface ContractView {
  status: string;
  signature: { envelopeId: string; documentHash: string } | null;
}

async function main(): Promise<void> {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const [contractId] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const decline = process.argv.includes('--decline');
  const secret = process.env.ESIGN_WEBHOOK_SECRET;
  if (!contractId || !secret) {
    throw new Error(
      'usage: pnpm esign:sign <contractId> [--decline], with ESIGN_WEBHOOK_SECRET set',
    );
  }
  const apiUrl = process.env.API_URL ?? 'http://localhost:3000';
  // It signs with the webhook secret: pointed at a real deployment it would sign contracts and
  // release payments. Local stacks only.
  if (process.env.NODE_ENV === 'production' || !LOCAL_HOSTS.has(new URL(apiUrl).hostname)) {
    throw new Error(`Refusing to sign for ${apiUrl}: this script is for a local stack only.`);
  }
  const baseUrl = `${apiUrl}/api/v1`;

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_USERS.ops, password: DEMO_PASSWORD }),
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const response = await fetch(`${baseUrl}/contracts/${contractId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const contract = (await response.json()) as ContractView;
  if (!contract.signature) {
    throw new Error(`Contract ${contractId} has not been sent for signature (${contract.status}).`);
  }

  const body = JSON.stringify({
    eventId: randomUUID(),
    type: decline ? 'envelope.declined' : 'envelope.completed',
    envelopeId: contract.signature.envelopeId,
    ...(decline ? {} : { documentHash: contract.signature.documentHash }),
    occurredAt: new Date().toISOString(),
  });
  const callback = await fetch(`${baseUrl}/webhooks/esign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Esign-Signature': signWebhook(secret, body, new Date()),
    },
    body,
  });
  process.stdout.write(
    `${decline ? 'Declined' : 'Signed'} ${contractId}: HTTP ${String(callback.status)}\n`,
  );
  if (!callback.ok) {
    process.stdout.write(`${await callback.text()}\n`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
