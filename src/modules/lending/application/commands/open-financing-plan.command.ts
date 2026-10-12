import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import {
  CLOCK,
  type Clock,
  EntityNotFoundError,
  InvalidStateTransitionError,
} from '@shared/domain';

import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  FINANCING_PLAN_REPOSITORY,
  FinancingPlan,
  type FinancingPlanRepository,
  LendingRecordExistsError,
} from '../../domain';

// Opens the repayment plan of an activated contract: its instalment table, or its ISA terms.
// Run after ContractActivated; one plan per contract.
export class OpenFinancingPlanCommand extends Command<void> {
  constructor(readonly contractId: string) {
    super();
  }
}

@CommandHandler(OpenFinancingPlanCommand)
export class OpenFinancingPlanHandler implements ICommandHandler<OpenFinancingPlanCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(FINANCING_PLAN_REPOSITORY) private readonly plans: FinancingPlanRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: OpenFinancingPlanCommand): Promise<void> {
    try {
      await this.uow.run(async () => {
        if (await this.plans.findByContractId(command.contractId)) {
          return;
        }
        const contract = await this.contracts.findById(command.contractId);
        if (!contract) {
          throw new EntityNotFoundError('Contract', command.contractId);
        }
        if (!contract.activatedOn) {
          throw new InvalidStateTransitionError('Contract', contract.status, 'plan');
        }
        await this.plans.save(
          FinancingPlan.open({
            id: uuidv7(),
            contractId: contract.id,
            studentId: contract.studentId,
            centerId: contract.centerId,
            principal: contract.terms.principal,
            product: contract.terms.product,
            programDurationWeeks: contract.program.durationWeeks,
            activatedOn: contract.activatedOn,
            now: this.clock.now(),
          }),
        );
      });
    } catch (error) {
      if (!(error instanceof LendingRecordExistsError)) {
        throw error;
      }
    }
  }
}
