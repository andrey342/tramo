// Billing, dunning and ISA windows depend on "today". Code asks the clock instead of calling
// `new Date()`, so tests and the demo can run at any date (ADR 009).
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }

  advanceBy(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
