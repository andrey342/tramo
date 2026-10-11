export * from './errors/origination-errors';
export * from './events/origination-events';
export {
  ageInYears,
  type ApplicantProfile,
  type CompleteProfile,
  EMPLOYMENT_STATUSES,
  EMPTY_PROFILE,
  type EmploymentStatus,
} from './model/applicant-profile';
export {
  type DecisionOutcome,
  type DecisionRecord,
  HARD_RULES,
  type HardRule,
  type ManualDecision,
  SCORE_FACTORS,
  type ScoreFactor,
  type ScoreFactorName,
} from './model/decision-record';
export { APPLICATION_STATUSES, type ApplicationStatus } from './model/application-status';
export {
  type ApplicationOrigin,
  EXPIRY_DAYS,
  FinancingApplication,
  type FinancingApplicationProps,
} from './model/financing-application';
export {
  assertProductOffered,
  type ProgramSnapshot,
  type RequestedProduct,
} from './model/program-snapshot';
export { RiskPolicy, type RiskPolicyProps, type ScoreWeights } from './model/risk-policy';
export {
  type BureauResult,
  type Checked,
  type EmploymentResult,
  type KycResult,
  NO_VERIFICATIONS,
  VERIFICATION_TYPES,
  type VerificationResult,
  type Verifications,
  type VerificationType,
} from './model/verification';
export * from './ports/origination-repositories';
export {
  assessedIncome,
  estimatedMonthlyPayment,
  ScoringEngine,
  type ScoringInput,
} from './services/scoring-engine';
