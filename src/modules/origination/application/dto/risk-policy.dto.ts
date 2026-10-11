export interface RiskPolicyWeightsDto {
  readonly employability: number;
  readonly employmentHistory: number;
  readonly affordability: number;
  readonly bureau: number;
}

export interface RiskPolicyDto {
  readonly version: number;
  readonly maxFinanceableCents: number;
  readonly minAgeYears: number;
  readonly allowedResidenceCountries: readonly string[];
  readonly weightsBasisPoints: RiskPolicyWeightsDto;
  readonly approveThreshold: number;
  readonly reviewThreshold: number;
  readonly createdAt: Date;
  readonly createdBy: string;
}

// What an admin may change in the next version; anything left out stays as in the current one.
export interface RiskPolicyChanges {
  readonly maxFinanceableCents?: number;
  readonly minAgeYears?: number;
  readonly allowedResidenceCountries?: readonly string[];
  readonly weightsBasisPoints?: RiskPolicyWeightsDto;
  readonly approveThreshold?: number;
  readonly reviewThreshold?: number;
}
