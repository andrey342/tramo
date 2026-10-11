// The states of a financing application (FinancingApplication describes the transitions).
export const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'verifying',
  'scoring',
  'approved',
  'needs_review',
  'rejected',
  'offer_accepted',
  'cancelled',
  'expired',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
