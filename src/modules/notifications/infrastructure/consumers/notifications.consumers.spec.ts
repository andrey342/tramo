import { type CommandBus } from '@nestjs/cqrs';

import { type IntegrationEvent } from '@shared/application';
import { type EventPayload } from '@shared/domain';

import { type PublishWebhookCommand } from '../../application/commands/publish-webhook.command';
import { type RequestEmailCommand } from '../../application/commands/request-email.command';

import {
  EmailOnApplicationRejected,
  EmailOnChargeOverdue,
  EmailOnDisbursementSettled,
  EmailOnIsaDeclarationOverdue,
  WebhookOnApplicationRejected,
  WebhookOnContractInArrears,
  WelcomeOnStudentRegistered,
} from './notifications.consumers';

const OCCURRED_AT = '2026-11-12T08:00:00.000Z';

function recorded(): { commands: CommandBus; executed: unknown[] } {
  const executed: unknown[] = [];
  const commands = {
    execute: (command: unknown) => {
      executed.push(command);
      return Promise.resolve(1);
    },
  } as unknown as CommandBus;
  return { commands, executed };
}

const event = <P extends EventPayload>(eventType: string, payload: P): IntegrationEvent<P> => ({
  eventId: 'event-1',
  eventType,
  aggregateType: 'Any',
  aggregateId: 'aggregate-1',
  occurredAt: OCCURRED_AT,
  correlationId: null,
  payload,
});

describe('notifications consumers', () => {
  it('should welcome a student at the address they registered with', async () => {
    const { commands, executed } = recorded();

    await new WelcomeOnStudentRegistered(commands).handle(
      event('StudentRegistered', { userId: 'u-1', email: 'new@example.com' }),
    );

    expect((executed[0] as RequestEmailCommand).request).toEqual({
      eventId: 'event-1',
      template: 'welcome',
      to: { address: 'new@example.com' },
      reference: 'u-1',
      data: {},
    });
  });

  it('should write to the center admins when a disbursement settles', async () => {
    const { commands, executed } = recorded();

    await new EmailOnDisbursementSettled(commands).handle(
      event('DisbursementSettled', {
        disbursementId: 'd-1',
        contractId: 'c-1',
        centerId: 'center-1',
        amountCents: 7_125_00,
      }),
    );

    expect((executed[0] as RequestEmailCommand).request).toMatchObject({
      template: 'disbursement_settled',
      to: { centerId: 'center-1' },
      reference: 'c-1',
    });
  });

  it('should tell a rejected student no, without the reasons', async () => {
    const { commands, executed } = recorded();

    await new EmailOnApplicationRejected(commands).handle(
      event('ApplicationRejected', {
        applicationId: 'a-1',
        applicantId: 's-1',
        centerId: 'center-1',
        reasonCodes: ['bureau_defaults'],
        decidedBy: 'engine',
      }),
    );

    expect((executed[0] as RequestEmailCommand).request).toMatchObject({
      template: 'application_decided',
      to: { userId: 's-1' },
      data: { approved: false },
    });
    expect(JSON.stringify(executed)).not.toContain('bureau_defaults');
  });

  it('should mark the second overdue notice as such', async () => {
    const { commands, executed } = recorded();

    await new EmailOnChargeOverdue(commands).handle(
      event('ChargeOverdue', {
        chargeId: 'ch-1',
        contractId: 'c-1',
        studentId: 's-1',
        amountCents: 337_50,
        notice: 2,
        daysOverdue: 15,
      }),
    );

    expect((executed[0] as RequestEmailCommand).request.data).toEqual({
      amountCents: 337_50,
      daysOverdue: 15,
      secondNotice: true,
    });
  });

  it('should tell the student when two ISA months in a row went undeclared', async () => {
    const { commands, executed } = recorded();

    await new EmailOnIsaDeclarationOverdue(commands).handle(
      event('IsaDeclarationOverdue', {
        planId: 'p-1',
        contractId: 'c-1',
        studentId: 's-1',
        missingSince: '2026-09',
      }),
    );

    expect((executed[0] as RequestEmailCommand).request).toEqual({
      eventId: 'event-1',
      template: 'isa_declaration_overdue',
      to: { userId: 's-1' },
      reference: 'c-1',
      data: { missingSince: '2026-09' },
    });
  });

  it('should tell the center of a decision and of arrears, without personal data', async () => {
    const { commands, executed } = recorded();

    await new WebhookOnApplicationRejected(commands).handle(
      event('ApplicationRejected', {
        applicationId: 'a-1',
        applicantId: 's-1',
        centerId: 'center-1',
        reasonCodes: ['kyc_failed'],
        decidedBy: 'engine',
      }),
    );
    await new WebhookOnContractInArrears(commands).handle(
      event('ContractInArrears', {
        contractId: 'c-1',
        studentId: 's-1',
        centerId: 'center-1',
        chargeId: 'ch-1',
        daysOverdue: 30,
      }),
    );

    const notices = executed.map((command) => (command as PublishWebhookCommand).notice);
    expect(notices).toEqual([
      {
        eventId: 'event-1',
        occurredAt: new Date(OCCURRED_AT),
        centerId: 'center-1',
        event: 'application.decided',
        data: { applicationId: 'a-1', decision: 'rejected', decidedBy: 'engine' },
      },
      {
        eventId: 'event-1',
        occurredAt: new Date(OCCURRED_AT),
        centerId: 'center-1',
        event: 'contract.in_arrears',
        data: { contractId: 'c-1', daysOverdue: 30 },
      },
    ]);
    expect(JSON.stringify(notices)).not.toContain('s-1');
  });
});
