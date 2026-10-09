import { type IncomingMessage, type ServerResponse } from 'node:http';

import { uuidv7 } from 'uuidv7';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

type RequestWithId = IncomingMessage & { id?: unknown };

// Both the CLS middleware and pino-http ask for the request id, in whichever order they run.
// The first call decides (caller-supplied header when well-formed, otherwise a UUIDv7) and stores
// it on the request; later calls reuse it.
export function resolveRequestId(req: RequestWithId, res?: ServerResponse): string {
  if (typeof req.id === 'string') {
    return req.id;
  }
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : uuidv7();
  req.id = id;
  res?.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
