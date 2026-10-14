import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  BillingEvents,
  type ChargeDueSoonPayload,
  type ChargeOverduePayload,
  type ChargeReturnedPayload,
  type ChargePaidPayload,
  type ContractInArrearsPayload,
  type IncomeDeclarationDuePayload,
} from '@modules/billing/domain/events/billing-events';
import { IamEvents, type StudentRegisteredPayload } from '@modules/iam/domain/events/iam-events';
import {
  type ContractDefaultedPayload,
  type ContractSentForSignaturePayload,
  type ContractSignedPayload,
  type DisbursementSettledPayload,
  type IsaDeclarationOverduePayload,
  LendingEvents,
} from '@modules/lending/domain/events/lending-events';
import {
  type ApplicationApprovedPayload,
  type ApplicationRejectedPayload,
  type ApplicationSubmittedPayload,
  OriginationEvents,
} from '@modules/origination/domain/events/origination-events';
import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';
import { type EventPayload } from '@shared/domain';

import {
  PublishWebhookCommand,
  type WebhookNotice,
} from '../../application/commands/publish-webhook.command';
import {
  type EmailRequest,
  RequestEmailCommand,
} from '../../application/commands/request-email.command';
import {
  type EmailRequestedPayload,
  NotificationsEvents,
  type WebhookDeliveryRequestedPayload,
} from '../../domain';
import { EmailJobs, WebhookJobs } from '../jobs/notifications-jobs';

// Each consumer is one effect of one event, processed exactly once (its claim in
// processed_events); a retried one finds the email or the delivery already written.

// ---- jobs: what was written down is sent by a job, keyed by it

@Injectable()
@EventSubscriber({
  event: NotificationsEvents.EmailRequested,
  consumer: 'notifications.send-email',
})
export class SendOnEmailRequested implements EventHandler<EmailRequestedPayload> {
  constructor(private readonly jobs: EmailJobs) {}

  async handle(event: IntegrationEvent<EmailRequestedPayload>): Promise<void> {
    await this.jobs.send(event.payload.notificationId, event.correlationId);
  }
}

@Injectable()
@EventSubscriber({
  event: NotificationsEvents.WebhookDeliveryRequested,
  consumer: 'notifications.deliver-webhook',
})
export class DeliverOnWebhookDeliveryRequested implements EventHandler<WebhookDeliveryRequestedPayload> {
  constructor(private readonly jobs: WebhookJobs) {}

  async handle(event: IntegrationEvent<WebhookDeliveryRequestedPayload>): Promise<void> {
    await this.jobs.deliver(event.payload.deliveryId, event.payload.round, event.correlationId);
  }
}

// ---- emails

// Decorated so its constructor parameters reach the subclasses (DI reads them from here).
@Injectable()
abstract class EmailConsumer<P extends EventPayload> {
  constructor(private readonly commands: CommandBus) {}

  protected abstract request(payload: P): Omit<EmailRequest, 'eventId'>;

  async handle(event: IntegrationEvent<P>): Promise<void> {
    await this.commands.execute(
      new RequestEmailCommand({ eventId: event.eventId, ...this.request(event.payload) }),
    );
  }
}

@Injectable()
@EventSubscriber({ event: IamEvents.StudentRegistered, consumer: 'notifications.welcome' })
export class WelcomeOnStudentRegistered
  extends EmailConsumer<StudentRegisteredPayload>
  implements EventHandler<StudentRegisteredPayload>
{
  protected request(payload: StudentRegisteredPayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'welcome',
      to: { address: payload.email },
      reference: payload.userId,
      data: {},
    };
  }
}

@Injectable()
@EventSubscriber({
  event: OriginationEvents.ApplicationSubmitted,
  consumer: 'notifications.email-application-received',
})
export class EmailOnApplicationSubmitted
  extends EmailConsumer<ApplicationSubmittedPayload>
  implements EventHandler<ApplicationSubmittedPayload>
{
  protected request(payload: ApplicationSubmittedPayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'application_received',
      to: { userId: payload.applicantId },
      reference: payload.applicationId,
      data: { amountCents: payload.amountCents, product: payload.product },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: OriginationEvents.ApplicationApproved,
  consumer: 'notifications.email-application-approved',
})
export class EmailOnApplicationApproved
  extends EmailConsumer<ApplicationApprovedPayload>
  implements EventHandler<ApplicationApprovedPayload>
{
  protected request(payload: ApplicationApprovedPayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'application_decided',
      to: { userId: payload.applicantId },
      reference: payload.applicationId,
      data: { approved: true },
    };
  }
}

// The reasons stay with Tramo (they come from credit and identity checks): the email says no.
@Injectable()
@EventSubscriber({
  event: OriginationEvents.ApplicationRejected,
  consumer: 'notifications.email-application-rejected',
})
export class EmailOnApplicationRejected
  extends EmailConsumer<ApplicationRejectedPayload>
  implements EventHandler<ApplicationRejectedPayload>
{
  protected request(payload: ApplicationRejectedPayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'application_decided',
      to: { userId: payload.applicantId },
      reference: payload.applicationId,
      data: { approved: false },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: LendingEvents.ContractSentForSignature,
  consumer: 'notifications.email-contract-ready',
})
export class EmailOnContractSentForSignature
  extends EmailConsumer<ContractSentForSignaturePayload>
  implements EventHandler<ContractSentForSignaturePayload>
{
  protected request(payload: ContractSentForSignaturePayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'contract_ready_to_sign',
      to: { userId: payload.studentId },
      reference: payload.contractId,
      data: { envelopeId: payload.envelopeId },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: LendingEvents.DisbursementSettled,
  consumer: 'notifications.email-disbursement-settled',
})
export class EmailOnDisbursementSettled
  extends EmailConsumer<DisbursementSettledPayload>
  implements EventHandler<DisbursementSettledPayload>
{
  protected request(payload: DisbursementSettledPayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'disbursement_settled',
      to: { centerId: payload.centerId },
      reference: payload.contractId,
      data: {
        amountCents: payload.amountCents,
        contractId: payload.contractId,
        disbursementId: payload.disbursementId,
      },
    };
  }
}

@Injectable()
@EventSubscriber({ event: BillingEvents.ChargeDueSoon, consumer: 'notifications.email-charge-due' })
export class EmailOnChargeDueSoon
  extends EmailConsumer<ChargeDueSoonPayload>
  implements EventHandler<ChargeDueSoonPayload>
{
  protected request(payload: ChargeDueSoonPayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'installment_reminder',
      to: { userId: payload.studentId },
      reference: payload.contractId,
      data: { amountCents: payload.amountCents, dueDate: payload.dueDate },
    };
  }
}

@Injectable()
@EventSubscriber({ event: BillingEvents.ChargePaid, consumer: 'notifications.email-charge-paid' })
export class EmailOnChargePaid
  extends EmailConsumer<ChargePaidPayload>
  implements EventHandler<ChargePaidPayload>
{
  protected request(payload: ChargePaidPayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'installment_collected',
      to: { userId: payload.studentId },
      reference: payload.contractId,
      data: { amountCents: payload.amountCents, kind: payload.kind },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: BillingEvents.ChargeOverdue,
  consumer: 'notifications.email-charge-overdue',
})
export class EmailOnChargeOverdue
  extends EmailConsumer<ChargeOverduePayload>
  implements EventHandler<ChargeOverduePayload>
{
  protected request(payload: ChargeOverduePayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'payment_overdue',
      to: { userId: payload.studentId },
      reference: payload.contractId,
      data: {
        amountCents: payload.amountCents,
        daysOverdue: payload.daysOverdue,
        secondNotice: payload.notice === 2,
      },
    };
  }
}

// The bank returned a debit already collected (billing reopened the charge): the student hears
// why it is owed again before dunning starts over.
@Injectable()
@EventSubscriber({
  event: BillingEvents.ChargeReturned,
  consumer: 'notifications.email-charge-returned',
})
export class EmailOnChargeReturned
  extends EmailConsumer<ChargeReturnedPayload>
  implements EventHandler<ChargeReturnedPayload>
{
  protected request(payload: ChargeReturnedPayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'payment_returned',
      to: { userId: payload.studentId },
      reference: payload.contractId,
      data: {
        amountCents: payload.amountCents,
        kind: payload.kind,
        reason: payload.reason,
        // A payoff is never dunned again (ADR 020): ops settle it with the student.
        payoff: payload.kind === 'payoff',
      },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: BillingEvents.ContractInArrears,
  consumer: 'notifications.email-contract-in-arrears',
})
export class EmailOnContractInArrears
  extends EmailConsumer<ContractInArrearsPayload>
  implements EventHandler<ContractInArrearsPayload>
{
  protected request(payload: ContractInArrearsPayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'contract_in_arrears',
      to: { userId: payload.studentId },
      reference: payload.contractId,
      data: { daysOverdue: payload.daysOverdue },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: BillingEvents.IncomeDeclarationDue,
  consumer: 'notifications.email-declaration-due',
})
export class EmailOnIncomeDeclarationDue
  extends EmailConsumer<IncomeDeclarationDuePayload>
  implements EventHandler<IncomeDeclarationDuePayload>
{
  protected request(payload: IncomeDeclarationDuePayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'isa_declaration_reminder',
      to: { userId: payload.studentId },
      reference: payload.contractId,
      data: { period: payload.period },
    };
  }
}

// Two ISA months in a row without a declaration (lending's assessment): the student is told once,
// until a declaration clears it.
@Injectable()
@EventSubscriber({
  event: LendingEvents.IsaDeclarationOverdue,
  consumer: 'notifications.email-declaration-overdue',
})
export class EmailOnIsaDeclarationOverdue
  extends EmailConsumer<IsaDeclarationOverduePayload>
  implements EventHandler<IsaDeclarationOverduePayload>
{
  protected request(payload: IsaDeclarationOverduePayload): Omit<EmailRequest, 'eventId'> {
    return {
      template: 'isa_declaration_overdue',
      to: { userId: payload.studentId },
      reference: payload.contractId,
      data: { missingSince: payload.missingSince },
    };
  }
}

// ---- webhooks to the training center: ids, amounts and states, never the student's data

@Injectable()
abstract class WebhookConsumer<P extends EventPayload> {
  constructor(private readonly commands: CommandBus) {}

  protected abstract notice(payload: P): Omit<WebhookNotice, 'eventId' | 'occurredAt'>;

  async handle(event: IntegrationEvent<P>): Promise<void> {
    await this.commands.execute(
      new PublishWebhookCommand({
        eventId: event.eventId,
        occurredAt: new Date(event.occurredAt),
        ...this.notice(event.payload),
      }),
    );
  }
}

@Injectable()
@EventSubscriber({
  event: OriginationEvents.ApplicationSubmitted,
  consumer: 'notifications.webhook-application-submitted',
})
export class WebhookOnApplicationSubmitted
  extends WebhookConsumer<ApplicationSubmittedPayload>
  implements EventHandler<ApplicationSubmittedPayload>
{
  protected notice(
    payload: ApplicationSubmittedPayload,
  ): Omit<WebhookNotice, 'eventId' | 'occurredAt'> {
    return {
      centerId: payload.centerId,
      event: 'application.submitted',
      data: {
        applicationId: payload.applicationId,
        programId: payload.programId,
        product: payload.product,
        amountCents: payload.amountCents,
      },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: OriginationEvents.ApplicationApproved,
  consumer: 'notifications.webhook-application-approved',
})
export class WebhookOnApplicationApproved
  extends WebhookConsumer<ApplicationApprovedPayload>
  implements EventHandler<ApplicationApprovedPayload>
{
  protected notice(
    payload: ApplicationApprovedPayload,
  ): Omit<WebhookNotice, 'eventId' | 'occurredAt'> {
    return {
      centerId: payload.centerId,
      event: 'application.decided',
      data: {
        applicationId: payload.applicationId,
        programId: payload.programId,
        decision: 'approved',
        decidedBy: payload.decidedBy,
      },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: OriginationEvents.ApplicationRejected,
  consumer: 'notifications.webhook-application-rejected',
})
export class WebhookOnApplicationRejected
  extends WebhookConsumer<ApplicationRejectedPayload>
  implements EventHandler<ApplicationRejectedPayload>
{
  protected notice(
    payload: ApplicationRejectedPayload,
  ): Omit<WebhookNotice, 'eventId' | 'occurredAt'> {
    return {
      centerId: payload.centerId,
      event: 'application.decided',
      data: {
        applicationId: payload.applicationId,
        programId: payload.programId,
        decision: 'rejected',
        decidedBy: payload.decidedBy,
      },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: LendingEvents.ContractSigned,
  consumer: 'notifications.webhook-contract-signed',
})
export class WebhookOnContractSigned
  extends WebhookConsumer<ContractSignedPayload>
  implements EventHandler<ContractSignedPayload>
{
  protected notice(payload: ContractSignedPayload): Omit<WebhookNotice, 'eventId' | 'occurredAt'> {
    return {
      centerId: payload.centerId,
      event: 'contract.signed',
      data: {
        contractId: payload.contractId,
        applicationId: payload.applicationId,
        disbursementAmountCents: payload.disbursementAmountCents,
        signedAt: payload.signedAt,
      },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: LendingEvents.DisbursementSettled,
  consumer: 'notifications.webhook-disbursement-settled',
})
export class WebhookOnDisbursementSettled
  extends WebhookConsumer<DisbursementSettledPayload>
  implements EventHandler<DisbursementSettledPayload>
{
  protected notice(
    payload: DisbursementSettledPayload,
  ): Omit<WebhookNotice, 'eventId' | 'occurredAt'> {
    return {
      centerId: payload.centerId,
      event: 'disbursement.settled',
      data: {
        disbursementId: payload.disbursementId,
        contractId: payload.contractId,
        amountCents: payload.amountCents,
      },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: BillingEvents.ContractInArrears,
  consumer: 'notifications.webhook-contract-in-arrears',
})
export class WebhookOnContractInArrears
  extends WebhookConsumer<ContractInArrearsPayload>
  implements EventHandler<ContractInArrearsPayload>
{
  protected notice(
    payload: ContractInArrearsPayload,
  ): Omit<WebhookNotice, 'eventId' | 'occurredAt'> {
    return {
      centerId: payload.centerId,
      event: 'contract.in_arrears',
      data: { contractId: payload.contractId, daysOverdue: payload.daysOverdue },
    };
  }
}

@Injectable()
@EventSubscriber({
  event: LendingEvents.ContractDefaulted,
  consumer: 'notifications.webhook-contract-defaulted',
})
export class WebhookOnContractDefaulted
  extends WebhookConsumer<ContractDefaultedPayload>
  implements EventHandler<ContractDefaultedPayload>
{
  protected notice(
    payload: ContractDefaultedPayload,
  ): Omit<WebhookNotice, 'eventId' | 'occurredAt'> {
    return {
      centerId: payload.centerId,
      event: 'contract.defaulted',
      data: { contractId: payload.contractId },
    };
  }
}

export const NOTIFICATION_CONSUMERS = [
  SendOnEmailRequested,
  DeliverOnWebhookDeliveryRequested,
  WelcomeOnStudentRegistered,
  EmailOnApplicationSubmitted,
  EmailOnApplicationApproved,
  EmailOnApplicationRejected,
  EmailOnContractSentForSignature,
  EmailOnDisbursementSettled,
  EmailOnChargeDueSoon,
  EmailOnChargePaid,
  EmailOnChargeOverdue,
  EmailOnChargeReturned,
  EmailOnContractInArrears,
  EmailOnIncomeDeclarationDue,
  EmailOnIsaDeclarationOverdue,
  WebhookOnApplicationSubmitted,
  WebhookOnApplicationApproved,
  WebhookOnApplicationRejected,
  WebhookOnContractSigned,
  WebhookOnDisbursementSettled,
  WebhookOnContractInArrears,
  WebhookOnContractDefaulted,
];
