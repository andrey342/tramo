import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Column, DataSource, Entity, PrimaryColumn } from 'typeorm';

import { InvalidValueError } from '@shared/domain';

import { ConfigModule } from '../config';
import { RequestContextModule } from '../context';

import { paginateByCursor } from './cursor-pagination';
import { DatabaseModule } from './database.module';

@Entity({ schema: 'public', name: 'page_probe' })
class PageProbeOrmEntity {
  @PrimaryColumn('text')
  id: string;

  @Column('timestamptz', { name: 'created_at' })
  createdAt: Date;
}

const ROWS = 23;

describe('paginateByCursor (integration)', () => {
  let app: INestApplicationContext;
  let db: DataSource;

  const page = (
    limit: number,
    cursor?: string,
  ): ReturnType<typeof paginateByCursor<PageProbeOrmEntity>> =>
    paginateByCursor(
      db.getRepository(PageProbeOrmEntity).createQueryBuilder('probe'),
      { limit, cursor },
      {
        sortColumn: 'probe.created_at',
        idColumn: 'probe.id',
        sortValueOf: (row) => row.createdAt.toISOString(),
        idOf: (row) => row.id,
      },
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        RequestContextModule,
        DatabaseModule.forRoot('tramo-int-tests'),
        TypeOrmModule.forFeature([PageProbeOrmEntity]),
      ],
    }).compile();
    app = await moduleRef.init();
    db = app.get(DataSource);
    await db.query(
      'CREATE TABLE IF NOT EXISTS public.page_probe (id text PRIMARY KEY, created_at timestamptz(3) NOT NULL DEFAULT now())',
    );
    await db.query('TRUNCATE public.page_probe');
    // Pairs of rows share a timestamp, so the id tie-breaker is exercised.
    for (let index = 0; index < ROWS; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 9, 1, 0, Math.floor(index / 2)));
      await db.query('INSERT INTO public.page_probe (id, created_at) VALUES ($1, $2)', [
        `row-${String(index).padStart(2, '0')}`,
        createdAt,
      ]);
    }
  });

  afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS public.page_probe');
    await app.close();
  });

  it('should walk every row exactly once, newest first, until nextCursor is null', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const result = await page(5, cursor);
      seen.push(...result.data.map((row) => row.id));
      cursor = result.nextCursor ?? undefined;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(5);
    expect(new Set(seen).size).toBe(ROWS);
    expect(seen[0]).toBe('row-22');
    expect(seen.at(-1)).toBe('row-00');
  });

  it('should not shift later pages when newer rows are inserted meanwhile', async () => {
    const first = await page(5);
    await db.query(
      "INSERT INTO public.page_probe (id, created_at) VALUES ('row-new', '2027-01-01T00:00:00Z')",
    );
    const second = await page(5, first.nextCursor ?? undefined);
    await db.query("DELETE FROM public.page_probe WHERE id = 'row-new'");

    expect(second.data.map((row) => row.id)).toEqual([
      'row-17',
      'row-16',
      'row-15',
      'row-14',
      'row-13',
    ]);
  });

  it('should not skip rows created within the same millisecond by the database clock', async () => {
    await db.query('TRUNCATE public.page_probe');
    await db.query(
      "INSERT INTO public.page_probe (id) SELECT 'burst-' || lpad(n::text, 2, '0') FROM generate_series(1, 12) AS n",
    );
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await page(5, cursor);
      seen.push(...result.data.map((row) => row.id));
      cursor = result.nextCursor ?? undefined;
    } while (cursor);

    expect(new Set(seen).size).toBe(12);
  });

  it('should return a null cursor when everything fits in one page', async () => {
    expect((await page(100)).nextCursor).toBeNull();
  });

  it('should reject a tampered cursor', async () => {
    await expect(page(5, 'not-a-cursor')).rejects.toThrow(InvalidValueError);
  });
});
