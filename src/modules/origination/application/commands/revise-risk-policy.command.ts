import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CLOCK, type Clock, Money, Percentage } from '@shared/domain';

import {
  ApplicationAccessDeniedError,
  RISK_POLICY_REPOSITORY,
  type RiskPolicyProps,
  type RiskPolicyRepository,
} from '../../domain';
import { toRiskPolicyDto } from '../application.mapping';
import { type RiskPolicyChanges, type RiskPolicyDto } from '../dto/risk-policy.dto';

export class ReviseRiskPolicyCommand extends Command<RiskPolicyDto> {
  constructor(
    readonly actor: Principal,
    readonly changes: RiskPolicyChanges,
  ) {
    super();
  }
}

// An admin publishes the next version of the risk policy. It applies to applications scored from
// then on; decisions already made keep the version they were made with.
@CommandHandler(ReviseRiskPolicyCommand)
export class ReviseRiskPolicyHandler implements ICommandHandler<ReviseRiskPolicyCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(RISK_POLICY_REPOSITORY) private readonly policies: RiskPolicyRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: ReviseRiskPolicyCommand): Promise<RiskPolicyDto> {
    const { actor, changes } = command;
    if (actor.kind !== 'user' || !actor.roles.includes('admin')) {
      throw new ApplicationAccessDeniedError();
    }
    return this.uow.run(async () => {
      const current = await this.policies.findCurrent();
      if (!current) {
        throw new Error('No risk policy in force; the first one is seeded by a migration.');
      }
      const next = current.revise(toPolicyChanges(changes), actor.userId, this.clock.now());
      await this.policies.add(next);
      const before = toRiskPolicyDto(current);
      const after = toRiskPolicyDto(next);
      this.audit.describeChanges({
        version: { before: before.version, after: after.version },
        ...Object.fromEntries(
          (
            [
              'maxFinanceableCents',
              'minAgeYears',
              'allowedResidenceCountries',
              'weightsBasisPoints',
              'approveThreshold',
              'reviewThreshold',
            ] as const
          )
            .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
            .map((field) => [field, { before: { ...before }[field], after: { ...after }[field] }]),
        ),
      });
      return after;
    });
  }
}

function toPolicyChanges(
  changes: RiskPolicyChanges,
): Partial<Omit<RiskPolicyProps, 'createdAt' | 'createdBy'>> {
  const weights = changes.weightsBasisPoints;
  return {
    ...(changes.maxFinanceableCents !== undefined && {
      maxFinanceable: Money.fromCents(changes.maxFinanceableCents),
    }),
    ...(changes.minAgeYears !== undefined && { minAgeYears: changes.minAgeYears }),
    ...(changes.allowedResidenceCountries !== undefined && {
      allowedResidenceCountries: changes.allowedResidenceCountries.map((country) =>
        country.toUpperCase(),
      ),
    }),
    ...(weights && {
      weights: {
        employability: Percentage.fromBasisPoints(weights.employability),
        employment_history: Percentage.fromBasisPoints(weights.employmentHistory),
        affordability: Percentage.fromBasisPoints(weights.affordability),
        bureau: Percentage.fromBasisPoints(weights.bureau),
      },
    }),
    ...(changes.approveThreshold !== undefined && { approveThreshold: changes.approveThreshold }),
    ...(changes.reviewThreshold !== undefined && { reviewThreshold: changes.reviewThreshold }),
  };
}
