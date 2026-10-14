import { InvalidValueError } from './domain-error';
import { ValueObject } from './value-object';

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A day in the calendar, without a time or a zone ('2026-10-12'). Due dates, billing periods and
// the ISA window are days, not instants; an instant becomes a day in UTC.
export class CalendarDate extends ValueObject<{ year: number; month: number; day: number }> {
  private constructor(year: number, month: number, day: number) {
    super({ year, month, day });
  }

  // month 1-12; `field`: the input it came from, named in the error (`asOf`).
  static of(year: number, month: number, day: number, field = 'date'): CalendarDate {
    const valid =
      Number.isInteger(year) &&
      year >= 1900 &&
      year <= 9999 &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12 &&
      Number.isInteger(day) &&
      day >= 1 &&
      day <= daysInMonth(year, month);
    if (!valid) {
      const shown = [year, month, day].map((part, index) =>
        String(part).padStart(index === 0 ? 4 : 2, '0'),
      );
      throw new InvalidValueError(field, `${shown.join('-')} is not a calendar date.`);
    }
    return new CalendarDate(year, month, day);
  }

  static parse(iso: string, field = 'date'): CalendarDate {
    const match = ISO_DATE.exec(iso);
    if (!match) {
      throw new InvalidValueError(field, `Expected a date as YYYY-MM-DD, got "${iso}".`);
    }
    return CalendarDate.of(Number(match[1]), Number(match[2]), Number(match[3]), field);
  }

  static fromInstant(instant: Date): CalendarDate {
    return new CalendarDate(
      instant.getUTCFullYear(),
      instant.getUTCMonth() + 1,
      instant.getUTCDate(),
    );
  }

  get year(): number {
    return this.props.year;
  }

  get month(): number {
    return this.props.month;
  }

  get day(): number {
    return this.props.day;
  }

  // The month as YYYY-MM: the billing period the day falls in.
  get period(): string {
    return this.toString().slice(0, 7);
  }

  // Same day `months` later; a day the target month lacks becomes its last (31 Jan + 1 = 28 Feb).
  addMonths(months: number): CalendarDate {
    const index = this.props.year * 12 + (this.props.month - 1) + months;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return CalendarDate.of(year, month, Math.min(this.props.day, daysInMonth(year, month)));
  }

  addDays(days: number): CalendarDate {
    return CalendarDate.fromInstant(new Date(this.epochMs() + days * DAY_MS));
  }

  // The given day of this month, or its last day if the month is shorter.
  withDay(day: number): CalendarDate {
    return CalendarDate.of(
      this.props.year,
      this.props.month,
      Math.min(day, daysInMonth(this.props.year, this.props.month)),
    );
  }

  startOfMonth(): CalendarDate {
    return new CalendarDate(this.props.year, this.props.month, 1);
  }

  // Whole days from this day to `other`: negative when `other` comes first.
  daysUntil(other: CalendarDate): number {
    return Math.round((other.epochMs() - this.epochMs()) / DAY_MS);
  }

  compare(other: CalendarDate): -1 | 0 | 1 {
    const difference = this.epochMs() - other.epochMs();
    if (difference === 0) {
      return 0;
    }
    return difference < 0 ? -1 : 1;
  }

  isBefore(other: CalendarDate): boolean {
    return this.compare(other) < 0;
  }

  isAfter(other: CalendarDate): boolean {
    return this.compare(other) > 0;
  }

  override toString(): string {
    const { year, month, day } = this.props;
    return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  private epochMs(): number {
    return Date.UTC(this.props.year, this.props.month - 1, this.props.day);
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
