export * from './errors/catalog-errors';
export * from './events/catalog-events';
export {
  type CenterStatus,
  TrainingCenter,
  type TrainingCenterProps,
} from './model/training-center';
export {
  type VatCheckResult,
  type VatValidation,
  type VatValidationStatus,
} from './model/vat-check';
export {
  type FinancingProduct,
  FinancingOptions,
  type InstallmentsOption,
  type IsaOption,
  MAX_TERM_MONTHS,
  MIN_TERM_MONTHS,
} from './model/financing-options';
export {
  MIN_EMPLOYABILITY_FOR_ISA_BPS,
  Program,
  type ProgramDetails,
  PROGRAM_MODALITIES,
  type ProgramModality,
  type ProgramProps,
  type ProgramStatus,
} from './model/program';
export * from './ports/catalog-repositories';
