import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';

import { parseConfig } from '@shared/infrastructure/config/app-config';

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
  let api: string;

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
  }, 120_000);

  afterAll(async () => {
    sender.onModuleDestroy();
    await mailpit.stop();
  });

  it('should hand a rendered email to the server, with its reference header', async () => {
    const rendered = new HandlebarsEmailRenderer().render(
      'installment_collected',
      { amountCents: 337_50, kind: 'installment' },
      'contract-ref-1',
    );

    await sender.send({ ...rendered, to: 'student@example.com', reference: 'contract-ref-1' });

    const list = (await (await fetch(`${api}/messages`)).json()) as {
      messages: MailpitMessage[];
    };
    const [message] = list.messages;
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

  it('should reject when the server cannot be reached', async () => {
    const unreachable = new SmtpEmailSender(
      parseConfig({ ...process.env, SMTP_HOST: '127.0.0.1', SMTP_PORT: '9' }),
    );

    await expect(
      unreachable.send({
        to: 'student@example.com',
        subject: 's',
        text: 't',
        html: '<p>t</p>',
        reference: 'r',
      }),
    ).rejects.toThrow();
    unreachable.onModuleDestroy();
  });
});
