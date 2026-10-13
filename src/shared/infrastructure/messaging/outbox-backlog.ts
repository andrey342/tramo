import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface OutboxBacklog {
  // Events not yet handed to the queues, counted up to COUNT_CAP.
  readonly pending: number;
  // Age of the oldest of them; 0 when none waits.
  readonly lagSeconds: number;
}

// Beyond this the exact number does not change what an operator does; counting further would
// make the read slowest exactly when the publisher is down.
export const COUNT_CAP = 10_000;
const STATEMENT_TIMEOUT_MS = 2_000;

// What the outbox publisher still has to do, for monitoring. Both reads go through the partial
// index of unpublished rows (ids are time ordered, so the first one is the oldest), and give up
// after STATEMENT_TIMEOUT_MS instead of holding a pooled connection.
@Injectable()
export class OutboxBacklogReader {
  constructor(private readonly db: DataSource) {}

  read(): Promise<OutboxBacklog> {
    return this.db.transaction(async (manager) => {
      await manager.query(`SET LOCAL statement_timeout = ${String(STATEMENT_TIMEOUT_MS)}`);
      const [row] = await manager.query<{ pending: string; lag: string | null }[]>(
        `SELECT
           (SELECT COUNT(*) FROM (
              SELECT 1 FROM shared.outbox_messages WHERE published_at IS NULL LIMIT ${String(COUNT_CAP)}
            ) unpublished) AS pending,
           (SELECT EXTRACT(EPOCH FROM now() - occurred_at) FROM shared.outbox_messages
             WHERE published_at IS NULL ORDER BY id LIMIT 1) AS lag`,
      );
      return {
        pending: Number(row?.pending ?? 0),
        lagSeconds: Math.max(0, Number(row?.lag ?? 0)),
      };
    });
  }
}
