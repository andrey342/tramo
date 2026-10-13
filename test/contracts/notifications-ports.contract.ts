import {
  EmailSendFailedError,
  type Centers,
  type EmailRenderer,
  type EmailSender,
  type Recipients,
  WebhookPostFailedError,
  type WebhookSender,
} from '../../src/modules/notifications/application/ports/notifications-ports';
import { EMAIL_TEMPLATES } from '../../src/modules/notifications/domain';

// The fakes of the unit tests and the real adapters agree on these.

export interface WebhookSenderHarness {
  readonly sender: WebhookSender;
  // An endpoint that answers `status`, and one that never answers.
  readonly answering: (status: number) => string;
  readonly unreachable: string;
}

export function webhookSenderContract(
  name: string,
  create: () => Promise<WebhookSenderHarness> | WebhookSenderHarness,
): void {
  describe(`${name} (WebhookSender contract)`, () => {
    const post = (sender: WebhookSender, url: string) =>
      sender.post({
        url,
        secret: 'whsec_contract',
        deliveryId: 'd-1',
        event: 'contract.signed',
        body: '{}',
      });

    it('should resolve with the status of any answer', async () => {
      const { sender, answering } = await create();

      expect(await post(sender, answering(204))).toEqual({ statusCode: 204 });
      expect(await post(sender, answering(503))).toEqual({ statusCode: 503 });
    });

    it('should reject with a category when there is no answer', async () => {
      const { sender, unreachable } = await create();

      const failure = await post(sender, unreachable).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(WebhookPostFailedError);
      expect((failure as WebhookPostFailedError).code).toMatch(/^[a-z_]+$/);
    });
  });
}

export interface EmailSenderHarness {
  readonly sender: EmailSender;
  // A sender whose server does not take the message.
  readonly failing: EmailSender;
  // What the server received, by recipient.
  readonly received: (to: string) => Promise<readonly { subject: string }[]>;
}

export function emailSenderContract(
  name: string,
  create: () => Promise<EmailSenderHarness> | EmailSenderHarness,
): void {
  describe(`${name} (EmailSender contract)`, () => {
    const email = (to: string) => ({
      to,
      subject: 'Contract subject',
      text: 'text',
      html: '<p>html</p>',
      reference: 'ref-1',
    });

    it('should hand the message to the server', async () => {
      const { sender, received } = await create();
      const to = `contract-${String(Date.now())}@example.com`;

      await sender.send(email(to));

      expect(await received(to)).toEqual([
        expect.objectContaining({ subject: 'Contract subject' }),
      ]);
    });

    it('should reject with a category when the server does not take it', async () => {
      const { failing } = await create();

      const failure = await failing.send(email('x@example.com')).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(EmailSendFailedError);
      expect((failure as EmailSendFailedError).code).toMatch(/^[a-z0-9_]+$/);
    });
  });
}

export function emailRendererContract(name: string, create: () => EmailRenderer): void {
  describe(`${name} (EmailRenderer contract)`, () => {
    it.each(EMAIL_TEMPLATES)('should render %s with a subject and the reference', (template) => {
      const email = create().render(template, { amountCents: 100 }, 'ref-42');

      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.text).toContain('ref-42');
      expect(email.html).toContain('ref-42');
    });
  });
}

export interface RecipientsHarness {
  readonly recipients: Recipients;
  readonly user: { readonly id: string; readonly email: string };
  readonly center: { readonly id: string; readonly emails: readonly string[] };
  readonly unknownId: string;
}

export function recipientsContract(
  name: string,
  create: () => Promise<RecipientsHarness> | RecipientsHarness,
): void {
  describe(`${name} (Recipients contract)`, () => {
    it('should give the address of a user, and none for an unknown one', async () => {
      const { recipients, user, unknownId } = await create();

      expect(await recipients.userEmail(user.id)).toBe(user.email);
      expect(await recipients.userEmail(unknownId)).toBeNull();
    });

    it('should list the addresses of a center, and none for an unknown one', async () => {
      const { recipients, center, unknownId } = await create();

      expect([...(await recipients.centerContacts(center.id))].sort()).toEqual(
        [...center.emails].sort(),
      );
      expect(await recipients.centerContacts(unknownId)).toEqual([]);
    });
  });
}

export interface CentersHarness {
  readonly centers: Centers;
  readonly knownId: string;
  readonly unknownId: string;
}

export function centersContract(
  name: string,
  create: () => Promise<CentersHarness> | CentersHarness,
): void {
  describe(`${name} (Centers contract)`, () => {
    it('should tell a known center from an unknown one', async () => {
      const { centers, knownId, unknownId } = await create();

      expect(await centers.exists(knownId)).toBe(true);
      expect(await centers.exists(unknownId)).toBe(false);
    });
  });
}
