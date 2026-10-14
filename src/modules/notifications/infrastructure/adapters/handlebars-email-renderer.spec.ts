import { EMAIL_TEMPLATES } from '../../domain';

import { formatMoney, HandlebarsEmailRenderer } from './handlebars-email-renderer';

const renderer = new HandlebarsEmailRenderer();

describe('HandlebarsEmailRenderer', () => {
  it.each(EMAIL_TEMPLATES)('should render %s with a subject, text, html and reference', (name) => {
    const email = renderer.render(
      name,
      {
        email: 'student@example.com',
        amountCents: 337_50,
        product: 'installments',
        approved: true,
        envelopeId: 'env-1',
        contractId: 'contract-1',
        disbursementId: 'disbursement-1',
        dueDate: '2026-12-12',
        kind: 'installment',
        daysOverdue: 30,
        secondNotice: false,
        period: '2026-11',
        missingSince: '2026-09',
      },
      'ref-123',
    );

    expect(email.subject.length).toBeGreaterThan(5);
    expect(email.subject).not.toContain('{{');
    expect(email.text).toContain('Reference: ref-123');
    expect(email.html).toContain('Reference: ref-123');
    expect(email.html).toMatch(/^<!doctype html>/);
  });

  it('should write amounts in euros from cents, without floating point', () => {
    expect(formatMoney(337_50)).toBe('337.50 EUR');
    expect(formatMoney(7)).toBe('0.07 EUR');
    expect(formatMoney(-1_005)).toBe('-10.05 EUR');
    expect(
      renderer.render('installment_collected', { amountCents: 2_000_00, kind: 'isa' }, 'r'),
    ).toMatchObject({
      subject: 'We have collected 2000.00 EUR',
      text: expect.stringContaining('for your income share payment'),
    });
  });

  it('should say yes or no in the decision email, and nothing of the reasons', () => {
    const approved = renderer.render('application_decided', { approved: true }, 'app-1');
    const rejected = renderer.render('application_decided', { approved: false }, 'app-1');

    expect(approved.subject).toBe('Your application is approved');
    expect(rejected.subject).toBe('About your application');
    expect(rejected.text).toContain('we cannot offer you financing');
  });

  it('should tell an ISA student since when declarations are missing and by when to declare', () => {
    const email = renderer.render('isa_declaration_overdue', { missingSince: '2026-09' }, 'c-1');

    expect(email.subject).toBe('Your income declarations are missing since 2026-09');
    expect(email.text).toContain('by the 4th of the next month');
  });

  // Retries come at 3 and 7 days: the notice at 15 promises none.
  it('should count days in the singular and promise a retry only in the first notice', () => {
    const first = renderer.render(
      'payment_overdue',
      { amountCents: 100_00, daysOverdue: 1, secondNotice: false },
      'c-1',
    );
    const second = renderer.render(
      'payment_overdue',
      { amountCents: 100_00, daysOverdue: 15, secondNotice: true },
      'c-1',
    );

    expect(first.text).toContain('now 1 day overdue.');
    expect(first.text).toContain('We will try the direct debit again');
    expect(second.text).toContain('now 15 days overdue.');
    expect(second.text).not.toContain('try the direct debit again');
  });

  it('should escape values in the HTML version only', () => {
    const email = renderer.render('contract_ready_to_sign', { envelopeId: '<b>env</b>' }, 'c-1');

    expect(email.html).toContain('&lt;b&gt;env&lt;/b&gt;');
    expect(email.text).toContain('<b>env</b>');
    expect(renderer.render('welcome', {}, 'u-1').text).not.toContain('@');
  });
});
