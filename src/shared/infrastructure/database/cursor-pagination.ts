import { type ObjectLiteral, type SelectQueryBuilder } from 'typeorm';

import { type CursorPage, type PageRequest } from '@shared/application';
import { InvalidValueError } from '@shared/domain';

interface CursorPosition {
  readonly sortValue: string;
  readonly id: string;
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify([position.sortValue, position.id])).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPosition {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(decoded) &&
      decoded.length === 2 &&
      typeof decoded[0] === 'string' &&
      typeof decoded[1] === 'string'
    ) {
      return { sortValue: decoded[0], id: decoded[1] };
    }
  } catch {
    // Falls through to the error below; the cause is not useful to the client.
  }
  throw new InvalidValueError(
    'cursor',
    'Cursor is not valid. Use the nextCursor of a previous page.',
  );
}

export interface CursorOptions<T> {
  // Columns as they appear in SQL for this query builder, e.g. `program.created_at`.
  readonly sortColumn: string;
  readonly idColumn: string;
  readonly direction?: 'ASC' | 'DESC';
  readonly sortValueOf: (row: T) => string;
  readonly idOf: (row: T) => string;
}

// Keyset pagination on (sort column, id): stable under concurrent inserts and the same cost on
// every page. Requires an index on (sortColumn, idColumn) in the same direction.
export async function paginateByCursor<T extends ObjectLiteral>(
  query: SelectQueryBuilder<T>,
  page: PageRequest,
  options: CursorOptions<T>,
): Promise<CursorPage<T>> {
  const direction = options.direction ?? 'DESC';
  if (page.cursor !== undefined) {
    const position = decodeCursor(page.cursor);
    const comparator = direction === 'DESC' ? '<' : '>';
    query.andWhere(
      `(${options.sortColumn}, ${options.idColumn}) ${comparator} (:cursorSortValue, :cursorId)`,
      { cursorSortValue: position.sortValue, cursorId: position.id },
    );
  }
  const rows = await query
    .orderBy(options.sortColumn, direction)
    .addOrderBy(options.idColumn, direction)
    .take(page.limit + 1)
    .getMany();

  const hasMore = rows.length > page.limit;
  const data = hasMore ? rows.slice(0, page.limit) : rows;
  const last = data.at(-1);
  return {
    data,
    nextCursor:
      hasMore && last
        ? encodeCursor({ sortValue: options.sortValueOf(last), id: options.idOf(last) })
        : null,
  };
}
