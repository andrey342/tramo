import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'shared', name: 'outbox_messages' })
export class OutboxMessageOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('text', { name: 'aggregate_type' })
  aggregateType: string;

  @Column('text', { name: 'aggregate_id' })
  aggregateId: string;

  @Column('text', { name: 'event_type' })
  eventType: string;

  @Column('jsonb')
  payload: object;

  @Column('timestamptz', { name: 'occurred_at' })
  occurredAt: Date;

  // Set by the database default; TypeORM 1.x only accepts insert/update flags in object form.
  @Column({
    type: 'timestamptz',
    name: 'created_at',
    insert: false,
    update: false,
    default: () => 'now()',
  })
  createdAt: Date;

  @Column('text', { name: 'correlation_id', nullable: true })
  correlationId: string | null;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  publishedAt: Date | null;

  @Column('integer', { default: 0 })
  attempts: number;

  @Column('text', { name: 'last_error', nullable: true })
  lastError: string | null;
}
