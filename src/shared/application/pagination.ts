// Cursor pagination contract shared by every list query (ADR 010). The cursor is opaque to clients.
export interface PageRequest {
  readonly limit: number;
  readonly cursor?: string;
}

export interface CursorPage<T> {
  readonly data: readonly T[];
  readonly nextCursor: string | null;
}

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
