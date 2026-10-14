import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';

import { type JsonValue, Money } from '@shared/domain';

import {
  type EmailRenderer,
  type RenderedEmail,
} from '../../application/ports/notifications-ports';
import { EMAIL_TEMPLATES, type EmailTemplate } from '../../domain';

interface TemplateSource {
  readonly subject: string;
  // Plain paragraphs; the HTML version wraps each in <p> inside the layout.
  readonly body: readonly string[];
}

// The emails, in English. Values come from the event that caused each one: ids, amounts in cents,
// dates. Nothing here decides anything; the wording is the only logic.
const SOURCES: Readonly<Record<EmailTemplate, TemplateSource>> = {
  welcome: {
    subject: 'Welcome to Tramo',
    body: [
      'Your account is ready.',
      'With Tramo you can finance a course at a partner training center, by instalments or with an income share agreement, and the center is paid from day one.',
    ],
  },
  application_received: {
    subject: 'We have received your application',
    body: [
      'Your application for {{money amountCents}} ({{product product}}) is with us.',
      'We are checking your identity, employment and credit history; you will hear from us as soon as there is a decision.',
    ],
  },
  application_decided: {
    subject: '{{#if approved}}Your application is approved{{else}}About your application{{/if}}',
    body: [
      '{{#if approved}}Good news: your application is approved. Review the offer and accept it to receive your contract.{{else}}We are sorry: we cannot offer you financing for this course at this time.{{/if}}',
    ],
  },
  contract_ready_to_sign: {
    subject: 'Your contract is ready to sign',
    body: [
      'Your financing contract is ready. You will receive the signature request from our e-signature provider (envelope {{envelopeId}}).',
      'Once you sign, Tramo pays your training center.',
    ],
  },
  disbursement_settled: {
    subject: 'Tramo has paid {{money amountCents}}',
    body: [
      'We have transferred {{money amountCents}} to your payout account for contract {{contractId}} (disbursement {{disbursementId}}).',
    ],
  },
  installment_reminder: {
    subject: 'Your payment of {{money amountCents}} is due on {{dueDate}}',
    body: [
      '{{money amountCents}} falls due on {{dueDate}} and is collected by direct debit under your mandate. Please make sure your account has funds that day.',
      'If you have not signed a direct debit mandate for this contract yet, sign it in the app: nothing can be collected without one.',
    ],
  },
  installment_collected: {
    subject: 'We have collected {{money amountCents}}',
    body: ['Thank you: we have collected {{money amountCents}} for your {{kind kind}}.'],
  },
  payment_overdue: {
    subject: 'Your payment of {{money amountCents}} is overdue',
    body: [
      'We could not collect {{money amountCents}}, now {{days daysOverdue}} overdue.',
      '{{#if secondNotice}}This is our second notice: please contact us to settle it, as the direct debit will not be retried on its own.{{else}}We will try the direct debit again; please make sure your account has funds, or contact us.{{/if}}',
    ],
  },
  contract_in_arrears: {
    subject: 'Your contract is in arrears',
    body: [
      'A payment of your contract is {{days daysOverdue}} overdue, so the contract is now in arrears.',
      'Paying what is overdue brings it back to normal. If you are in difficulty, contact us: we can look at your options.',
    ],
  },
  isa_declaration_reminder: {
    subject: 'Declare your income for {{period}}',
    body: [
      'Your income share agreement needs your gross income for {{period}}, even if it was zero.',
      'Declare it in the app before the 5th; a month without a declaration is paused, and two in a row are followed up.',
    ],
  },
  payment_returned: {
    subject: 'Your bank returned a payment of {{money amountCents}}',
    body: [
      'Your bank returned the direct debit of {{money amountCents}} for your {{kind kind}} that we had collected (reason {{reason}}), so it is owed again.',
      'We will try the direct debit again in a few days; please make sure your account accepts it, or contact us.',
    ],
  },
  isa_declaration_overdue: {
    subject: 'Your income declarations are missing since {{missingSince}}',
    body: [
      'We have not received a declaration of your income for your income share agreement since {{missingSince}}. Those months were paused: nothing was charged for them.',
      'Please declare your gross income every month in the app, by the 4th of the next month, even if it was zero. If something is stopping you, contact us.',
    ],
  },
};

const LAYOUT = Handlebars.compile(
  `<!doctype html>
<html lang="en">
  <body style="font-family: sans-serif; color: #1f2933; max-width: 560px">
    {{#each paragraphs}}<p>{{{this}}}</p>
    {{/each}}<p style="color: #6b7280; font-size: 12px">Reference: {{reference}}</p>
  </body>
</html>`,
);

// Integer cents to "1234.56 EUR", through Money: no floating point between the event and the
// email, and a value that is not whole cents is refused rather than rounded.
export function formatMoney(cents: number): string {
  return Money.fromCents(cents).toString();
}

const PRODUCT_NAMES: Readonly<Record<string, string>> = {
  installments: 'instalments',
  isa: 'income share agreement',
};

const KIND_NAMES: Readonly<Record<string, string>> = {
  installment: 'instalment',
  isa: 'income share payment',
  payoff: 'early repayment',
};

function engine(): typeof Handlebars {
  const instance = Handlebars.create();
  instance.registerHelper('money', (cents: unknown) =>
    typeof cents === 'number' ? formatMoney(cents) : '',
  );
  instance.registerHelper('days', (count: unknown) =>
    typeof count === 'number' ? `${String(count)} ${count === 1 ? 'day' : 'days'}` : '',
  );
  instance.registerHelper('product', (value: unknown) =>
    typeof value === 'string' ? (PRODUCT_NAMES[value] ?? value) : '',
  );
  instance.registerHelper('kind', (value: unknown) =>
    typeof value === 'string' ? (KIND_NAMES[value] ?? value) : '',
  );
  return instance;
}

type Render = (data: object) => string;

interface Compiled {
  readonly subject: Render;
  readonly text: readonly Render[];
  readonly html: readonly Render[];
}

@Injectable()
export class HandlebarsEmailRenderer implements EmailRenderer {
  private readonly compiled = new Map<EmailTemplate, Compiled>();

  constructor() {
    const handlebars = engine();
    // Values are escaped in the HTML version only.
    const plain = { noEscape: true };
    for (const template of EMAIL_TEMPLATES) {
      const source = SOURCES[template];
      this.compiled.set(template, {
        subject: handlebars.compile(source.subject, plain),
        text: source.body.map((paragraph) => handlebars.compile(paragraph, plain)),
        html: source.body.map((paragraph) => handlebars.compile(paragraph)),
      });
    }
  }

  render(
    template: EmailTemplate,
    data: Readonly<Record<string, JsonValue>>,
    reference: string,
  ): RenderedEmail {
    const compiled = this.compiled.get(template);
    if (!compiled) {
      throw new Error(`No email template ${template}.`);
    }
    const text = [...compiled.text.map((paragraph) => paragraph(data)), `Reference: ${reference}`];
    return {
      subject: compiled.subject(data).trim(),
      text: text.join('\n\n'),
      html: LAYOUT({ paragraphs: compiled.html.map((paragraph) => paragraph(data)), reference }),
    };
  }
}
