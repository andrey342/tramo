import { isApiKeyScope, isRole } from './access';
import { AggregateRoot } from './aggregate-root';
import { FixedClock } from './clock';
import { DateRange } from './date-range';
import {
  ConcurrentModificationError,
  EntityNotFoundError,
  InvalidStateTransitionError,
  InvalidValueError,
} from './domain-error';
import { type DomainEvent } from './domain-event';
import { Email } from './email';
import { Money } from './money';
import { err, ok, unwrap } from './result';
import { ValueObject } from './value-object';

class Counter extends AggregateRoot {
  static create(id: string): Counter {
    return new Counter(id);
  }

  increment(at: Date): void {
    this.record({
      eventType: 'CounterIncremented',
      aggregateType: 'Counter',
      aggregateId: this.id,
      occurredAt: at,
      payload: {},
    });
  }
}

describe('AggregateRoot', () => {
  it('should hand out recorded events once', () => {
    const counter = Counter.create('c-1');
    counter.increment(new Date('2026-10-01T00:00:00Z'));
    counter.increment(new Date('2026-10-02T00:00:00Z'));

    const events: readonly DomainEvent[] = counter.pullEvents();

    expect(events.map((event) => event.occurredAt.toISOString())).toEqual([
      '2026-10-01T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z',
    ]);
    expect(counter.hasPendingEvents).toBe(false);
    expect(counter.pullEvents()).toEqual([]);
  });

  it('should compare entities by identity', () => {
    expect(Counter.create('c-1').equals(Counter.create('c-1'))).toBe(true);
    expect(Counter.create('c-1').equals(Counter.create('c-2'))).toBe(false);
  });
});

describe('Email', () => {
  it('should normalise to lower case without surrounding spaces', () => {
    expect(unwrap(Email.create('  Ana.Garcia@Example.COM ')).value).toBe('ana.garcia@example.com');
  });

  it.each(['', 'ana', 'ana@', 'ana@example', 'a b@example.com'])('should reject %p', (raw) => {
    expect(Email.create(raw).ok).toBe(false);
  });
});

describe('DateRange', () => {
  const october = DateRange.of(new Date('2026-10-01'), new Date('2026-10-31'));

  it('should include both boundaries', () => {
    expect(october.contains(new Date('2026-10-01'))).toBe(true);
    expect(october.contains(new Date('2026-10-31'))).toBe(true);
    expect(october.contains(new Date('2026-11-01'))).toBe(false);
  });

  it('should detect overlaps, including touching ranges', () => {
    const lastDay = DateRange.of(new Date('2026-10-31'), new Date('2026-11-30'));
    const november = DateRange.of(new Date('2026-11-01'), new Date('2026-11-30'));

    expect(october.overlaps(lastDay)).toBe(true);
    expect(october.overlaps(november)).toBe(false);
  });

  it('should reject an inverted range', () => {
    expect(() => DateRange.of(new Date('2026-10-31'), new Date('2026-10-01'))).toThrow(
      InvalidValueError,
    );
  });

  it('should not leak its internal dates', () => {
    october.start.setFullYear(1999);

    expect(october.start.getFullYear()).toBe(2026);
  });
});

describe('FixedClock', () => {
  it('should return the configured time and move only when told to', () => {
    const clock = new FixedClock(new Date('2026-10-09T10:00:00Z'));
    clock.advanceBy(60_000);

    expect(clock.now().toISOString()).toBe('2026-10-09T10:01:00.000Z');

    clock.set(new Date('2027-01-01T00:00:00Z'));
    expect(clock.now().getUTCFullYear()).toBe(2027);
  });
});

describe('Result', () => {
  it('should unwrap ok values and throw the error of failures', () => {
    expect(unwrap(ok(42))).toBe(42);
    expect(() =>
      unwrap(err(new InvalidStateTransitionError('Contract', 'DRAFT', 'ACTIVE'))),
    ).toThrow('Contract cannot move from DRAFT to ACTIVE.');
  });
});

class Pair extends ValueObject<{ left: unknown; right?: unknown }> {
  static of(left: unknown, right?: unknown): Pair {
    return new Pair(right === undefined ? { left } : { left, right });
  }
}

class OtherPair extends ValueObject<{ left: unknown }> {
  static of(left: unknown): OtherPair {
    return new OtherPair({ left });
  }
}

describe('ValueObject equality', () => {
  it('should compare nested value objects and dates by value', () => {
    expect(
      Pair.of(Money.fromCents(1), new Date(0)).equals(Pair.of(Money.fromCents(1), new Date(0))),
    ).toBe(true);
    expect(Pair.of(Money.fromCents(1)).equals(Pair.of(Money.fromCents(2)))).toBe(false);
  });

  it('should not be equal to null, another type or a different shape', () => {
    expect(Pair.of(1).equals(null)).toBe(false);
    expect(Pair.of(1).equals(OtherPair.of(1))).toBe(false);
    expect(Pair.of(1).equals(Pair.of(1, 2))).toBe(false);
  });
});

describe('domain errors', () => {
  it('should carry a stable code, a category and details', () => {
    const error = new EntityNotFoundError('Program', 'p-1');

    expect(error).toMatchObject({
      code: 'not_found',
      category: 'not_found',
      name: 'EntityNotFoundError',
      details: { entity: 'Program', id: 'p-1' },
    });
  });
});

describe('edge cases', () => {
  it('should reject invalid dates in a range and expose its end', () => {
    expect(() => DateRange.of(new Date('nope'), new Date())).toThrow(InvalidValueError);
    expect(DateRange.of(new Date(0), new Date(1)).end.getTime()).toBe(1);
  });

  it('should print an email as its address', () => {
    expect(String(unwrap(Email.create('ana@example.com')))).toBe('ana@example.com');
  });

  it('should report the sign of an amount', () => {
    expect(Money.fromCents(1).isPositive()).toBe(true);
    expect(Money.fromCents(-1).isNegative()).toBe(true);
    expect(Money.fromCents(2).gt(Money.fromCents(1))).toBe(true);
    expect(Money.fromCents(1).lte(Money.fromCents(1))).toBe(true);
    expect(Money.fromCents(1).compare(Money.fromCents(1))).toBe(0);
  });
});

describe('aggregate versions and access vocabulary', () => {
  it('should start unpersisted and remember the version it was loaded at', () => {
    const counter = Counter.create('c-9');
    expect(counter.version).toBe(0);
    counter.markPersisted(3);
    expect(counter.version).toBe(3);
  });

  it('should describe a lost update as a conflict', () => {
    expect(new ConcurrentModificationError('Contract', 'k-1')).toMatchObject({
      code: 'concurrent_modification',
      category: 'conflict',
    });
  });

  it('should recognise roles and scopes', () => {
    expect([isRole('ops'), isRole('root')]).toEqual([true, false]);
    expect([isApiKeyScope('programs:read'), isApiKeyScope('everything')]).toEqual([true, false]);
  });
});
