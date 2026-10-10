// Published contract of the catalog module: other modules subscribe to these by event type and
// read the payload, never the aggregates. Payloads are type aliases (not interfaces) so they
// satisfy the JSON payload constraint of DomainEvent.
export const CatalogEvents = {
  CenterRegistered: 'CenterRegistered',
  CenterActivated: 'CenterActivated',
  CenterSuspended: 'CenterSuspended',
  CenterPayoutAccountChanged: 'CenterPayoutAccountChanged',
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

// Only the last digits: notifications warn the center, and nobody downstream needs the account.
export type CenterPayoutAccountChangedPayload = {
  readonly centerId: string;
  readonly ibanLastFour: string;
};
