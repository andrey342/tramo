import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { parseConfig } from '@shared/infrastructure/config/app-config';

import { emailSenderContract } from '../../../../../test/contracts/notifications-ports.contract';

import { HandlebarsEmailRenderer } from './handlebars-email-renderer';
import { SmtpEmailSender } from './smtp-email-sender';

// The same Mailpit as docker-compose.yml: what the server accepted is read back from its API.
const MAILPIT_IMAGE = 'axllent/mailpit:v1.31.4';

interface MailpitMessage {
  readonly ID: string;
  readonly Subject: string;
  readonly From: { readonly Address: string };
  readonly To: readonly { readonly Address: string }[];
}

describe('SmtpEmailSender (integration)', () => {
  let mailpit: StartedTestContainer;
  let sender: SmtpEmailSender;
  let unreachable: SmtpEmailSender;
  let api: string;

  const messagesTo = async (to: string): Promise<MailpitMessage[]> => {
    const found = (await (
      await fetch(`${api}/search?query=${encodeURIComponent(`to:${to}`)}`)
    ).json()) as { messages: MailpitMessage[] };
    return found.messages;
  };

  beforeAll(async () => {
    mailpit = await new GenericContainer(MAILPIT_IMAGE)
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/livez', 8025))
      .start();
    api = `http://${mailpit.getHost()}:${String(mailpit.getMappedPort(8025))}/api/v1`;
    sender = new SmtpEmailSender(
      parseConfig({
        ...process.env,
        SMTP_HOST: mailpit.getHost(),
        SMTP_PORT: String(mailpit.getMappedPort(1025)),
        EMAIL_FROM: 'Tramo <no-reply@tramo.test>',
      }),
    );
    unreachable = new SmtpEmailSender(
      parseConfig({ ...process.env, SMTP_HOST: '127.0.0.1', SMTP_PORT: '9' }),
    );
  }, 120_000);

  afterAll(async () => {
    sender.onModuleDestroy();
    unreachable.onModuleDestroy();
    await mailpit.stop();
  });

  emailSenderContract('SmtpEmailSender', () => ({
    sender,
    failing: unreachable,
    received: async (to) => (await messagesTo(to)).map((message) => ({ subject: message.Subject })),
  }));

  it('should send a rendered email with its reference header, to one mailbox', async () => {
    const rendered = new HandlebarsEmailRenderer().render(
      'installment_collected',
      { amountCents: 337_50, kind: 'installment' },
      'contract-ref-1',
    );

    await sender.send({ ...rendered, to: 'student@example.com', reference: 'contract-ref-1' });

    const [message] = await messagesTo('student@example.com');
    expect(message).toMatchObject({
      Subject: 'We have collected 337.50 EUR',
      From: { Address: 'no-reply@tramo.test' },
      To: [{ Address: 'student@example.com' }],
    });
    const headers = (await (
      await fetch(`${api}/message/${message?.ID ?? ''}/headers`)
    ).json()) as Record<string, string[]>;
    expect(headers['X-Tramo-Reference']).toEqual(['contract-ref-1']);
  });
});
