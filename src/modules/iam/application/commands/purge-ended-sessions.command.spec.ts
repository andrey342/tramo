import { uuidv7 } from 'uuidv7';

import { FixedClock } from '@shared/domain';

import { InMemoryRefreshTokenRepository } from '../../../../../test/fakes/iam';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../../test/fakes/shared';
import { RefreshToken } from '../../domain';

import {
  ENDED_SESSION_RETENTION_DAYS,
  PurgeEndedSessionsCommand,
  PurgeEndedSessionsHandler,
} from './purge-ended-sessions.command';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-09T10:00:00Z');

function tokenOfSessionEnding(familyExpiresAt: Date): RefreshToken {
  return RefreshToken.issue({
    id: uuidv7(),
    familyId: uuidv7(),
    userId: uuidv7(),
    tokenHash: `hash-${uuidv7()}`,
    now: new Date(familyExpiresAt.getTime() - DAY_MS),
    ttlMs: DAY_MS,
    familyExpiresAt,
  });
}

describe('PurgeEndedSessions', () => {
  it('should delete the tokens of sessions that ended over a month ago, a batch per transaction', async () => {
    const uow = new InlineUnitOfWork();
    const refreshTokens = new InMemoryRefreshTokenRepository(new RecordingEventBus());
    const daysAgo = (days: number): Date => new Date(NOW.getTime() - days * DAY_MS);
    const old = [40, 35, 31].map((days) => tokenOfSessionEnding(daysAgo(days)));
    const kept = [
      tokenOfSessionEnding(daysAgo(ENDED_SESSION_RETENTION_DAYS - 1)),
      tokenOfSessionEnding(new Date(NOW.getTime() + 30 * DAY_MS)),
    ];
    for (const token of [...old, ...kept]) await refreshTokens.save(token);
    const handler = new PurgeEndedSessionsHandler(uow, refreshTokens, new FixedClock(NOW));

    const result = await handler.execute(new PurgeEndedSessionsCommand(2));

    expect(result).toEqual({ deleted: 3 });
    expect(uow.runs).toBe(2);
    expect(
      refreshTokens
        .all()
        .map((token) => token.id)
        .sort(),
    ).toEqual(kept.map((token) => token.id).sort());
  });
});
