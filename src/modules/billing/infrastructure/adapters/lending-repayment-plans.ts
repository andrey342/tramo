import { Injectable } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';

import { FindContractQuery } from '@modules/lending/application/dto/contract-lookup';
import {
  AssessIsaPeriodCommand,
  ListBillablePlansQuery,
} from '@modules/lending/application/dto/plan-lookup';

import {
  type BillablePlan,
  type IsaAssessment,
  type RepaidContract,
  type RepaymentPlans,
} from '../../application/ports/billing-ports';

// Asks lending through its public queries and command, never through its tables (ADR 008). The
// ISA assessment joins billing's unit of work: lending's plan and billing's charge are written in
// one transaction.
@Injectable()
export class LendingRepaymentPlans implements RepaymentPlans {
  constructor(
    private readonly queries: QueryBus,
    private readonly commands: CommandBus,
  ) {}

  findContract(contractId: string): Promise<RepaidContract | null> {
    return this.queries.execute(new FindContractQuery(contractId));
  }

  billablePlans(afterContractId: string | null, limit: number): Promise<readonly BillablePlan[]> {
    return this.queries.execute(new ListBillablePlansQuery(afterContractId, limit));
  }

  async assessIsaPeriod(
    contractId: string,
    period: string,
    declaredIncomeCents: number | null,
  ): Promise<IsaAssessment> {
    const assessment = await this.commands.execute(
      new AssessIsaPeriodCommand(contractId, period, declaredIncomeCents),
    );
    return assessment.outcome === 'charge' ? assessment : { outcome: assessment.outcome };
  }
}
