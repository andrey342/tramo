export abstract class ValueObject<P extends object> {
  protected readonly props: Readonly<P>;

  protected constructor(props: P) {
    this.props = Object.freeze({ ...props });
  }

  equals(other: ValueObject<P> | null | undefined): boolean {
    if (other === null || other === undefined || other.constructor !== this.constructor) {
      return false;
    }
    return shallowEqual(this.props, other.props);
  }
}

function shallowEqual(a: object, b: object): boolean {
  const keysA = Object.keys(a) as (keyof typeof a)[];
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) => {
    const left: unknown = a[key];
    const right: unknown = b[key];
    if (left instanceof ValueObject && right instanceof ValueObject) {
      return left.equals(right);
    }
    if (left instanceof Date && right instanceof Date) {
      return left.getTime() === right.getTime();
    }
    return Object.is(left, right);
  });
}
