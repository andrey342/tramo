import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { FindPublishedProgramQuery } from '@modules/catalog/application/dto/program-lookup';
import { Money, Percentage } from '@shared/domain';

import { type ProgramDirectory } from '../../application/ports/origination-ports';
import { type ProgramSnapshot } from '../../domain';

// Asks the catalog module through its public query, never through its tables (ADR 008).
@Injectable()
export class CatalogProgramDirectory implements ProgramDirectory {
  constructor(private readonly queries: QueryBus) {}

  async findOpenProgram(programId: string): Promise<ProgramSnapshot | null> {
    const program = await this.queries.execute(new FindPublishedProgramQuery(programId));
    if (!program) {
      return null;
    }
    const { installments, isa } = program.financing;
    return {
      programId: program.id,
      centerId: program.centerId,
      name: program.name,
      price: Money.fromCents(program.priceCents),
      employabilityRate: Percentage.fromBasisPoints(program.employabilityRateBasisPoints),
      avgStartingSalary: Money.fromCents(program.avgStartingSalaryCents),
      installments: installments && {
        allowedTerms: installments.allowedTerms,
        annualRate: Percentage.fromBasisPoints(installments.annualRateBasisPoints),
      },
      isa: isa && {
        incomeShare: Percentage.fromBasisPoints(isa.incomeShareBasisPoints),
        minMonthlyIncome: Money.fromCents(isa.minMonthlyIncomeCents),
        maxPayments: isa.maxPayments,
        capMultiplierHundredths: isa.capMultiplierHundredths,
        graceMonths: isa.graceMonths,
      },
    };
  }
}
