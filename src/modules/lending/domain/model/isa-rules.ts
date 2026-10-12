import { type CalendarDate } from '@shared/domain';

// An ISA obligation lapses this long after the end of the program, whatever has been paid.
export const ISA_WINDOW_YEARS = 8;

// The course is taken to start when the contract is activated (the center has been paid) and to
// last the program's duration.
export function programEnd(activatedOn: CalendarDate, durationWeeks: number): CalendarDate {
  return activatedOn.addDays(durationWeeks * 7);
}

// Payments start with the first full month after the grace period.
export function firstIsaPeriod(end: CalendarDate, graceMonths: number): CalendarDate {
  return end.addMonths(graceMonths).startOfMonth().addMonths(1);
}

export function isaWindowEnd(end: CalendarDate): CalendarDate {
  return end.addMonths(ISA_WINDOW_YEARS * 12);
}
