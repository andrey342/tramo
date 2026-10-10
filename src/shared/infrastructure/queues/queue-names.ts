export const MODULES = [
  'iam',
  'catalog',
  'origination',
  'lending',
  'billing',
  'notifications',
  'reporting',
] as const;

export type ModuleName = (typeof MODULES)[number];

// One events queue per consuming module, so a slow consumer in one module never delays the
// others, and every queue is visible on its own in Bull Board.
export const eventsQueue = (module: ModuleName): string => `events.${module}`;

export const QueueNames = {
  DEAD_LETTER: 'dead-letter',
  EVENTS: MODULES.map(eventsQueue),
  // Work queues of a module, for jobs with their own retry schedule or that must not run inside
  // an event's transaction.
  VAT_CHECKS: 'catalog.vat-checks',
} as const;

export function eventsQueueForConsumer(consumer: string): string {
  const module = consumer.slice(0, consumer.indexOf('.'));
  if (!(MODULES as readonly string[]).includes(module)) {
    throw new Error(`Consumer "${consumer}" does not start with a known module name.`);
  }
  return `events.${module}`;
}

export const ALL_QUEUES: readonly string[] = [
  QueueNames.DEAD_LETTER,
  ...QueueNames.EVENTS,
  QueueNames.VAT_CHECKS,
];
