import { type IncomingMessage, type ServerResponse } from 'node:http';

import { REQUEST_ID_HEADER, resolveRequestId } from './request-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exchange(header?: string): { req: IncomingMessage; res: ServerResponse; sent: string[] } {
  const sent: string[] = [];
  const req = {
    headers: header === undefined ? {} : { [REQUEST_ID_HEADER]: header },
  } as unknown as IncomingMessage;
  const res = {
    setHeader: (_name: string, value: string) => sent.push(value),
  } as unknown as ServerResponse;
  return { req, res, sent };
}

describe('resolveRequestId', () => {
  it('should keep the caller id and send it back when it is a UUID', () => {
    const callerId = '0199A000-0000-7000-8000-00000000c001';
    const { req, res, sent } = exchange(callerId);

    expect(resolveRequestId(req, res)).toBe(callerId);
    expect(sent).toEqual([callerId]);
  });

  it('should generate an id when the caller sends free text, even a short safe one', () => {
    for (const header of ['req-audit-1', 'admin', 'a'.repeat(128), "x' OR 1=1", '']) {
      const { req, res, sent } = exchange(header);

      const id = resolveRequestId(req, res);

      expect(id).toMatch(UUID);
      expect(sent).toEqual([id]);
    }
  });

  it('should give later callers the id the first one decided', () => {
    const { req, res } = exchange();

    expect(resolveRequestId(req)).toBe(resolveRequestId(req, res));
  });
});
