import { type CalendarDate } from '@shared/domain';

// An ISA obligation lapses this long after the end of the program, whatever has been paid.
export const ISA_WINDOW_YEARS = 8;

// The course is taken to start when the contract is activated (the center has been paid) and to
// last the program's duration.
export function programEnd(activatedOn: CalendarDate, durationWeeks: number): CalendarDate {
  return activatedOn.addDays(durationWeeks * 7);
}

// Payments start with the first full month after the grace period: the month the grace ends in
// if it ends on its first day, the next one otherwise.
export function firstIsaPeriod(end: CalendarDate, graceMonths: number): CalendarDate {
  const graceEnds = end.addMonths(graceMonths);
  return graceEnds.day === 1 ? graceEnds : graceEnds.startOfMonth().addMonths(1);
}

export function isaWindowEnd(end: CalendarDate): CalendarDate {
  return end.addMonths(ISA_WINDOW_YEARS * 12);
}
