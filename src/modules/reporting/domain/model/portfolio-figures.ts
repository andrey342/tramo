import { Decimal } from 'decimal.js';

import { InvalidValueError, Money, Percentage } from '@shared/domain';

// The figures dashboards show, from the counts and sums the read models group.

export type Product = 'installments' | 'isa';

// `part` of `whole` as a percentage, half up to the basis point; none while there is no whole
// (no decided application, no contract being repaid).
export function shareOf(part: number, whole: number): Percentage | null {
  if (!Number.isInteger(part) || !Number.isInteger(whole) || part < 0 || part > whole) {
    throw new InvalidValueError(
      'share',
      `Expected 0 <= part <= whole, got ${String(part)} of ${String(whole)}.`,
    );
  }
  if (whole === 0) {
    return null;
  }
  return Percentage.fromBasisPoints(
    new Decimal(part)
      .times(10_000)
      .dividedBy(whole)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber(),
  );
}

// The mean of `count` amounts adding up to `totalCents`, half up to the cent; none for no amount.
export function averageOf(totalCents: number, count: number): Money | null {
  if (count === 0) {
    return null;
  }
  return Money.fromCents(
    new Decimal(totalCents).dividedBy(count).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
  );
}

export interface ApplicationCounts {
  readonly submitted: number;
  readonly approved: number;
  readonly needsReview: number;
  readonly rejected: number;
  readonly offerAccepted: number;
  readonly cancelled: number;
  readonly expired: number;
}

export interface ContractCounts {
  readonly active: number;
  readonly inArrears: number;
  readonly completed: number;
  readonly defaulted: number;
  readonly cancelled: number;
}

export interface MoneyFigures {
  readonly disbursedCents: number;
  readonly collectedCents: number;
  // Charged and not collected yet: scheduled, failed or overdue. A payoff being collected is left
  // out: it covers the charges still open, which are counted already.
  readonly outstandingCents: number;
  readonly writtenOffCents: number;
}

export interface ProductFigures extends MoneyFigures {
  readonly product: Product;
  readonly contracts: ContractCounts;
}

export interface CenterFigures extends MoneyFigures {
  // Applications submitted, by where they are now; one approved and then accepted counts as
  // accepted. Drafts are not in the funnel.
  readonly applications: ApplicationCounts;
  readonly contracts: ContractCounts;
  readonly byProduct: readonly ProductFigures[];
}

// What the read models group for a center: counts and sums by product (null when the contract is
// not known) and state.
export interface CenterRows {
  readonly applications: readonly { readonly status: string; readonly count: number }[];
  readonly contracts: readonly {
    readonly product: Product | null;
    readonly status: string;
    readonly count: number;
  }[];
  readonly disbursements: readonly {
    readonly product: Product | null;
    readonly status: string;
    readonly cents: number;
  }[];
  readonly charges: readonly {
    readonly product: Product | null;
    readonly kind: string | null;
    readonly status: string;
    readonly cents: number;
  }[];
}

type Tally<T> = { -readonly [K in keyof T]: T[K] };

const APPLICATION_COUNT: Readonly<Record<string, keyof ApplicationCounts>> = {
  submitted: 'submitted',
  approved: 'approved',
  needs_review: 'needsReview',
  rejected: 'rejected',
  offer_accepted: 'offerAccepted',
  cancelled: 'cancelled',
  expired: 'expired',
};

const CONTRACT_COUNT: Readonly<Record<string, keyof ContractCounts>> = {
  active: 'active',
  in_arrears: 'inArrears',
  completed: 'completed',
  defaulted: 'defaulted',
  cancelled: 'cancelled',
};

const CHARGE_MONEY: Readonly<Record<string, keyof MoneyFigures>> = {
  paid: 'collectedCents',
  scheduled: 'outstandingCents',
  failed: 'outstandingCents',
  overdue: 'outstandingCents',
  written_off: 'writtenOffCents',
};

const PRODUCTS: readonly Product[] = ['installments', 'isa'];

const noContracts = (): Tally<ContractCounts> => ({
  active: 0,
  inArrears: 0,
  completed: 0,
  defaulted: 0,
  cancelled: 0,
});

const noMoney = (): Tally<MoneyFigures> => ({
  disbursedCents: 0,
  collectedCents: 0,
  outstandingCents: 0,
  writtenOffCents: 0,
});

// The center's figures from its grouped rows: in total, and by product where the contract is
// known.
export function centerFigures(rows: CenterRows): CenterFigures {
  const applications: Tally<ApplicationCounts> = {
    submitted: 0,
    approved: 0,
    needsReview: 0,
    rejected: 0,
    offerAccepted: 0,
    cancelled: 0,
    expired: 0,
  };
  for (const row of rows.applications) {
    const key = APPLICATION_COUNT[row.status];
    if (key) applications[key] += row.count;
  }
  const totals = { contracts: noContracts(), money: noMoney() };
  const byProduct = PRODUCTS.map((product) => ({
    product,
    contracts: noContracts(),
    money: noMoney(),
  }));
  const targets = (product: Product | null): (typeof totals)[] => {
    const own = byProduct.find((entry) => entry.product === product);
    return own ? [totals, own] : [totals];
  };
  for (const row of rows.contracts) {
    const key = CONTRACT_COUNT[row.status];
    if (!key) continue;
    for (const target of targets(row.product)) target.contracts[key] += row.count;
  }
  for (const row of rows.disbursements) {
    if (row.status !== 'settled') continue;
    for (const target of targets(row.product)) target.money.disbursedCents += row.cents;
  }
  for (const row of rows.charges) {
    const key = CHARGE_MONEY[row.status];
    if (!key || (key === 'outstandingCents' && row.kind === 'payoff')) continue;
    for (const target of targets(row.product)) target.money[key] += row.cents;
  }
  return {
    applications,
    contracts: totals.contracts,
    ...totals.money,
    byProduct: byProduct.map(({ product, contracts, money }) => ({ product, contracts, ...money })),
  };
}
