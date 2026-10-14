import { AsyncLocalStorage } from 'node:async_hooks';

import { ClsService } from 'nestjs-cls';

import { ClsAuditTrail } from './cls-audit-trail';

describe('ClsAuditTrail', () => {
  const cls = new ClsService(new AsyncLocalStorage());
  const trail = new ClsAuditTrail(cls);

  // A unit of work runs in a copy of the context; what it describes still reaches the entry.
  it('should keep changes described inside a nested context', () => {
    const collected = cls.run(() => {
      trail.open();
      cls.run({ ifNested: 'inherit' }, () => {
        trail.describeChanges({ status: { before: 'active', after: 'suspended' } });
      });
      return trail.collected();
    });

    expect(collected).toEqual({ status: { before: 'active', after: 'suspended' } });
  });

  // A repeated, idempotent call changes nothing and is recorded so.
  it('should leave out what did not change', () => {
    const collected = cls.run(() => {
      trail.open();
      trail.describeChanges({
        status: { before: 'revoked', after: 'revoked' },
        scopes: { before: ['a'], after: ['a'] },
      });
      return trail.collected();
    });

    expect(collected).toBeUndefined();
  });
});
