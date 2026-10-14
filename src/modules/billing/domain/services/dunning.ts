import { type CalendarDate } from '@shared/domain';

export type DunningAction =
  'reminder' | 'first_notice' | 'retry' | 'second_notice' | 'arrears' | 'write_off';

export interface DunningStep {
  // Days from the due date: negative before it.
  readonly offset: number;
  readonly action: DunningAction;
}

// What happens to a charge that is not paid, by days from its due date: a reminder three days
// before, a notice the day after, two more collection attempts, a second notice, arrears at 30
// days and the end at 90, when it is written off and the contract defaults.
export const DUNNING_STEPS: readonly DunningStep[] = [
  { offset: -3, action: 'reminder' },
  { offset: 1, action: 'first_notice' },
  { offset: 3, action: 'retry' },
  { offset: 7, action: 'retry' },
  { offset: 15, action: 'second_notice' },
  { offset: 30, action: 'arrears' },
  { offset: 90, action: 'write_off' },
];

export const ARREARS_STEP = DUNNING_STEPS.findIndex((step) => step.action === 'arrears');

// Days from the due date to the write-off, when the contract defaults.
export const WRITE_OFF_DAYS =
  DUNNING_STEPS.find((step) => step.action === 'write_off')?.offset ?? Number.POSITIVE_INFINITY;

// The steps that come before the due date (the reminder): a charge due again at once, after its
// payment was returned, starts past them.
export const STEPS_BEFORE_DUE = DUNNING_STEPS.filter((step) => step.offset <= 0).length;

// The steps due on `asOf` that have not been applied yet (`applied` counts those that have, in
// order). A run that missed days catches up with every step it passed.
export function dunningStepsDue(
  dueDate: CalendarDate,
  asOf: CalendarDate,
  applied: number,
): readonly DunningStep[] {
  const daysPastDue = dueDate.daysUntil(asOf);
  return DUNNING_STEPS.slice(applied).filter((step) => step.offset <= daysPastDue);
}
