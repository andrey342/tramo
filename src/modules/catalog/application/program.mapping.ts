import { type Program } from '../domain';

import { type ProgramDto } from './dto/program.dto';

export function toProgramDto(program: Program): ProgramDto {
  const details = program.details;
  const { installments, isa } = program.financing;
  return {
    id: program.id,
    centerId: program.centerId,
    name: details.name,
    modality: details.modality,
    priceCents: details.price.cents,
    currency: details.price.currency,
    durationWeeks: details.durationWeeks,
    startDates: details.startDates,
    employabilityRateBasisPoints: details.employabilityRate.basisPoints,
    avgStartingSalaryCents: details.avgStartingSalary.cents,
    financing: {
      installments: installments
        ? {
            allowedTerms: installments.allowedTerms,
            annualRateBasisPoints: installments.annualRate.basisPoints,
          }
        : null,
      isa: isa
        ? {
            incomeShareBasisPoints: isa.incomeShare.basisPoints,
            minMonthlyIncomeCents: isa.minMonthlyIncome.cents,
            maxPayments: isa.maxPayments,
            capMultiplierHundredths: isa.capMultiplierHundredths,
            graceMonths: isa.graceMonths,
          }
        : null,
    },
    products: program.financing.products,
    status: program.status,
    publishedAt: program.publishedAt,
    createdAt: program.createdAt,
  };
}
