import { InvalidValueError } from './domain-error';
import { ValueObject } from './value-object';

// Inclusive on both ends: a range from the 1st to the 31st contains both days.
export class DateRange extends ValueObject<{ start: Date; end: Date }> {
  private constructor(start: Date, end: Date) {
    super({ start: new Date(start.getTime()), end: new Date(end.getTime()) });
  }

  static of(start: Date, end: Date): DateRange {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new InvalidValueError('dateRange', 'Range boundaries must be valid dates.');
    }
    if (start.getTime() > end.getTime()) {
      throw new InvalidValueError('dateRange', 'Range start must not be after its end.');
    }
    return new DateRange(start, end);
  }

  get start(): Date {
    return new Date(this.props.start.getTime());
  }

  get end(): Date {
    return new Date(this.props.end.getTime());
  }

  contains(date: Date): boolean {
    const time = date.getTime();
    return time >= this.props.start.getTime() && time <= this.props.end.getTime();
  }

  overlaps(other: DateRange): boolean {
    return (
      this.props.start.getTime() <= other.props.end.getTime() &&
      other.props.start.getTime() <= this.props.end.getTime()
    );
  }
}
