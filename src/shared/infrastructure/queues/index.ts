export { type DeadLetter, DeadLetterQueue } from './dead-letter.queue';
export {
  ALL_QUEUES,
  eventsQueue,
  eventsQueueForConsumer,
  type ModuleName,
  MODULES,
  QueueNames,
} from './queue-names';
export { type CorrelatedJobData, QueueProcessor } from './queue-processor';
export { QueuesModule } from './queues.module';
export { bullConnection } from './redis-connection';
