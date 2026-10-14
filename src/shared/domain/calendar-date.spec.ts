import { CalendarDate } from './calendar-date';
import { InvalidValueError } from './domain-error';

const day = (iso: string): CalendarDate => CalendarDate.parse(iso);

describe('CalendarDate', () => {
  it('should parse a day and print it back', () => {
    expect(day('2026-02-05').toString()).toBe('2026-02-05');
    expect(day('2026-02-05').period).toBe('2026-02');
  });

  it.each(['2026-02-30', '2026-13-01', '2026-2-5', '05/02/2026', '2026-00-10'])(
    'should refuse %s',
    (value) => {
      expect(() => day(value)).toThrow('date');
    },
  );

  // A day given in a request is reported under the request's own field name.
  it('should name the field a malformed day came from', () => {
    const fieldOf = (parse: () => unknown): string | undefined => {
      try {
        parse();
        return undefined;
      } catch (error) {
        return error instanceof InvalidValueError ? error.field : undefined;
      }
    };

    expect(fieldOf(() => CalendarDate.parse('2026-13-40', 'asOf'))).toBe('asOf');
    expect(fieldOf(() => CalendarDate.parse('soon', 'asOf'))).toBe('asOf');
    expect(fieldOf(() => CalendarDate.parse('soon'))).toBe('date');
  });

  it('should take the day of an instant in UTC', () => {
    expect(CalendarDate.fromInstant(new Date('2026-10-12T23:30:00Z')).toString()).toBe(
      '2026-10-12',
    );
    expect(CalendarDate.fromInstant(new Date('2026-10-12T23:30:00-02:00')).toString()).toBe(
      '2026-10-13',
    );
  });

  it('should add months keeping the day, or the last day of a shorter month', () => {
    expect(day('2026-01-31').addMonths(1).toString()).toBe('2026-02-28');
    expect(day('2028-01-31').addMonths(1).toString()).toBe('2028-02-29');
    expect(day('2026-11-15').addMonths(3).toString()).toBe('2027-02-15');
    expect(day('2026-03-31').addMonths(-1).toString()).toBe('2026-02-28');
    expect(day('2026-10-12').addMonths(96).toString()).toBe('2034-10-12');
  });

  it('should add days across months and years', () => {
    expect(day('2026-12-30').addDays(3).toString()).toBe('2027-01-02');
    expect(day('2026-03-01').addDays(-1).toString()).toBe('2026-02-28');
  });

  it('should count the days between two dates and order them', () => {
    expect(day('2026-01-05').daysUntil(day('2026-02-05'))).toBe(31);
    expect(day('2026-02-05').daysUntil(day('2026-01-05'))).toBe(-31);
    expect(day('2026-01-05').isBefore(day('2026-01-06'))).toBe(true);
    expect(day('2026-01-06').isAfter(day('2026-01-05'))).toBe(true);
    expect(day('2026-01-05').compare(day('2026-01-05'))).toBe(0);
    expect(day('2026-01-05').equals(day('2026-01-05'))).toBe(true);
  });

  it('should move to another day of the month or to its first day', () => {
    expect(day('2026-02-10').withDay(31).toString()).toBe('2026-02-28');
    expect(day('2026-02-10').startOfMonth().toString()).toBe('2026-02-01');
  });
});
