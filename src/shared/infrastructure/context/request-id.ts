import { type IncomingMessage, type ServerResponse } from 'node:http';

import { uuidv7 } from 'uuidv7';

export const REQUEST_ID_HEADER = 'x-request-id';
// Only a UUID is taken from the caller. The id is written to every log line, to the outbox and to
// the audit log; free text (up to 128 characters of it) let a client write what it liked there. A
// UUID keeps one shape and size, and still lets a client follow its own calls.
const CLIENT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RequestWithId = IncomingMessage & { id?: unknown };

// Both the CLS middleware and pino-http ask for the request id, in whichever order they run.
// The first call decides (the caller's header when it is a UUID, otherwise a new UUIDv7) and
// stores it on the request; later calls reuse it.
export function resolveRequestId(req: RequestWithId, res?: ServerResponse): string {
  if (typeof req.id === 'string') {
    return req.id;
  }
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && CLIENT_REQUEST_ID.test(incoming) ? incoming : uuidv7();
  req.id = id;
  res?.setHeader(REQUEST_ID_HEADER, id);
  return id;
}
