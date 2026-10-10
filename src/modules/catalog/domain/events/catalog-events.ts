// Published contract of the catalog module: other modules subscribe to these by event type and
// read the payload, never the aggregates. Payloads are type aliases (not interfaces) so they
// satisfy the JSON payload constraint of DomainEvent.
export const CatalogEvents = {
  CenterRegistered: 'CenterRegistered',
  CenterActivated: 'CenterActivated',
  CenterSuspended: 'CenterSuspended',
  CenterRenamed: 'CenterRenamed',
  CenterPlatformFeeChanged: 'CenterPlatformFeeChanged',
  CenterPayoutAccountChanged: 'CenterPayoutAccountChanged',
  CenterVatInvalidated: 'CenterVatInvalidated',
  ProgramPublished: 'ProgramPublished',
  ProgramDetailsChanged: 'ProgramDetailsChanged',
  ProgramFinancingChanged: 'ProgramFinancingChanged',
  ProgramArchived: 'ProgramArchived',
} as const;

export type CenterRegisteredPayload = {
  readonly centerId: string;
  readonly name: string;
  readonly country: string;
  readonly taxId: string;
};

export type CenterActivatedPayload = {
  readonly centerId: string;
};

export type CenterSuspendedPayload = {
  readonly centerId: string;
  readonly reason: string;
};

export type CenterRenamedPayload = {
  readonly centerId: string;
  readonly name: string;
};

// The commission Tramo keeps on every disbursement to the center from now on.
export type CenterPlatformFeeChangedPayload = {
  readonly centerId: string;
  readonly platformFeeBasisPoints: number;
};

// The registry no longer knows a VAT number that was valid. The center keeps its status; ops
// decide whether to suspend it, and this event is how they hear about it.
export type CenterVatInvalidatedPayload = {
  readonly centerId: string;
  readonly provider: string;
};

// Only the last digits: notifications warn the center, and nobody downstream needs the account.
export type CenterPayoutAccountChangedPayload = {
  readonly centerId: string;
  readonly ibanLastFour: string;
};

export type ProgramPublishedPayload = {
  readonly programId: string;
  readonly centerId: string;
  readonly name: string;
  readonly priceCents: number;
  readonly products: readonly string[];
};

// Everything a published program shows, so a consumer's copy never needs the aggregate. Sent when
// a published program's details change (price, dates, employability...).
export type ProgramDetailsChangedPayload = {
  readonly programId: string;
  readonly centerId: string;
  readonly name: string;
  readonly modality: string;
  readonly priceCents: number;
  readonly durationWeeks: number;
  readonly startDates: readonly string[];
  readonly employabilityRateBasisPoints: number;
  readonly avgStartingSalaryCents: number;
};

// Origination quotes from the options in force when an application is made; consumers keep their
// own copy, so the payload carries every option in full, not only what changed.
export type ProgramFinancingChangedPayload = {
  readonly programId: string;
  readonly centerId: string;
  readonly products: readonly string[];
  readonly installments: {
    readonly allowedTerms: readonly number[];
    readonly annualRateBasisPoints: number;
  } | null;
  readonly isa: {
    readonly incomeShareBasisPoints: number;
    readonly minMonthlyIncomeCents: number;
    readonly maxPayments: number;
    readonly capMultiplierHundredths: number;
    readonly graceMonths: number;
  } | null;
};

export type ProgramArchivedPayload = {
  readonly programId: string;
  readonly centerId: string;
};
