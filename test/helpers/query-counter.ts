import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner';

// Counts the SQL statements sent to Postgres while `work` runs, transaction control included.
// Every TypeORM path (repositories, query builders, DataSource.query) goes through this method.
export async function countQueries(work: () => Promise<unknown>): Promise<number> {
  const query = jest.spyOn(PostgresQueryRunner.prototype, 'query');
  try {
    await work();
    return query.mock.calls.length;
  } finally {
    query.mockRestore();
  }
}
