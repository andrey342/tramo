import { ProblemException } from './problem-details';
import { ProblemExpressAdapter } from './problem-express-adapter';

// The body parser's client errors, as it raises them: `type`, `status` and `expose`.
const parserError = (type: string, status: number): Error =>
  Object.assign(new Error(`raw ${type}`), { type, status, statusCode: status, expose: true });

describe('ProblemExpressAdapter', () => {
  const adapter = new ProblemExpressAdapter();

  it.each([
    ['entity.parse.failed', 400, 'malformed_body'],
    ['entity.too.large', 413, 'payload_too_large'],
    ['charset.unsupported', 415, 'unsupported_media_type'],
    ['encoding.unsupported', 415, 'unsupported_media_type'],
    ['request.aborted', 400, 'bad_request'],
  ])('should answer a body refused as %s with %d %s', (type, status, code) => {
    const mapped = adapter.mapException(parserError(type, status));

    expect(mapped).toBeInstanceOf(ProblemException);
    expect(mapped).toMatchObject({ code });
    expect((mapped as ProblemException).getStatus()).toBe(status);
    expect((mapped as ProblemException).message).not.toContain('raw');
  });

  it('should leave errors that are not a client error of the parser alone', () => {
    const boom = new Error('boom');

    expect(adapter.mapException(boom)).toBe(boom);
    expect(
      adapter.mapException(Object.assign(new Error('x'), { status: 500, expose: false })),
    ).toEqual(expect.any(Error));
  });
});
