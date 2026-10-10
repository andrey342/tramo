import { DataSource } from 'typeorm';

import { parseDatabaseConfig } from '../config';

import { runMigrationsExclusively } from './run-migrations';
import { typeOrmOptions } from './typeorm-options';

describe('runMigrationsExclusively (integration)', () => {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const scratchDatabase = `migrations_race_${String(Date.now())}`;
  let admin: DataSource;

  const dataSourceFor = (name: string): DataSource => {
    const url = new URL(databaseUrl);
    url.pathname = `/${scratchDatabase}`;
    return new DataSource(
      typeOrmOptions(parseDatabaseConfig({ DATABASE_URL: url.toString() }), name),
    );
  };

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url: databaseUrl }).initialize();
    await admin.query(`CREATE DATABASE ${scratchDatabase}`);
  });

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${scratchDatabase} WITH (FORCE)`);
    await admin.destroy();
  });

  it('should apply each migration once when two replicas start together', async () => {
    const replicas = [dataSourceFor('replica-a'), dataSourceFor('replica-b')];
    await Promise.all(replicas.map((replica) => replica.initialize()));
    try {
      const applied = await Promise.all(
        replicas.map((replica) => runMigrationsExclusively(replica)),
      );

      const rows: { name: string }[] = await replicas[0]!.query('SELECT name FROM migrations');
      expect(applied.flat()).toHaveLength(rows.length);
      expect(new Set(rows.map((row) => row.name)).size).toBe(rows.length);
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await Promise.all(replicas.map((replica) => replica.destroy()));
    }
  });
});
