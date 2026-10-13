export { type DeadLetter, DeadLetterQueue } from './dead-letter.queue';
export {
  EVENT_JOB_ATTEMPTS,
  EVENT_JOB_BACKOFF_MS,
  EVENT_JOB_OPTIONS,
  eventJobId,
} from './event-jobs';
export {
  ALL_QUEUES,
  eventsQueue,
  eventsQueueForConsumer,
  type ModuleName,
  MODULES,
  QueueNames,
} from './queue-names';
export { type CorrelatedJobData, QueueProcessor } from './queue-processor';
export { QUEUE_CALL_TIMEOUT_MS, QueueUnreachableError, withinQueueTimeout } from './queue-timeout';
export { QueuesModule } from './queues.module';
export { bullConnection } from './redis-connection';
