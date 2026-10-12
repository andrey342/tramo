export const CONTRACT_STATUSES = [
  'draft',
  'sent_for_signature',
  'signed',
  'active',
  'completed',
  'defaulted',
  'cancelled',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
