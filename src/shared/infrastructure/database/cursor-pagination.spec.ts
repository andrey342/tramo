import { InvalidValueError } from '@shared/domain';

import { decodeCursor, encodeCursor } from './cursor-pagination';

const ID = '0199a000-0000-7000-8000-000000000001';
const raw = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('decodeCursor', () => {
  it('should read back what encodeCursor wrote', () => {
    const position = { sortValue: '2026-10-09T10:00:00.123Z', id: ID };

    expect(decodeCursor(encodeCursor(position))).toEqual(position);
  });

  it('should reject cursors that are not two strings', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(InvalidValueError);
    expect(() => decodeCursor(raw(['2026-10-09T10:00:00Z']))).toThrow(InvalidValueError);
    expect(() => decodeCursor(raw([1, ID]))).toThrow(InvalidValueError);
  });

  it('should reject values that would not cast to a timestamp or a uuid', () => {
    expect(() => decodeCursor(raw(['x', ID]))).toThrow(InvalidValueError);
    expect(() => decodeCursor(raw(['2026-13-45T99:00:00Z', ID]))).toThrow(InvalidValueError);
    expect(() => decodeCursor(raw(['2026-10-09T10:00:00Z', 'y']))).toThrow(InvalidValueError);
  });

  it('should accept any text when the query sorts or keys on text columns', () => {
    expect(decodeCursor(raw(['ana', 'row-01']), 'text', 'text')).toEqual({
      sortValue: 'ana',
      id: 'row-01',
    });
  });
});
