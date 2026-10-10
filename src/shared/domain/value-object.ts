export abstract class ValueObject<P extends object> {
  protected readonly props: Readonly<P>;

  protected constructor(props: P) {
    this.props = Object.freeze({ ...props });
  }

  // Structural: nested value objects, dates, arrays and plain objects compare by content.
  equals(other: ValueObject<P> | null | undefined): boolean {
    if (other === null || other === undefined || other.constructor !== this.constructor) {
      return false;
    }
    return sameValue(this.props, other.props);
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof ValueObject && right instanceof ValueObject) {
    return left.equals(right);
  }
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((item, index) => sameValue(item, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left);
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => key in right && sameValue(left[key], right[key]))
    );
  }
  return Object.is(left, right);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
