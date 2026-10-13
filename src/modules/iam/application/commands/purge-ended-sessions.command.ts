import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { REFRESH_TOKEN_REPOSITORY, type RefreshTokenRepository } from '../../domain';

const DAY_MS = 24 * 60 * 60 * 1000;
// A session's tokens outlive it by a month: a rotated token stolen and presented after the
// session ended is still recognised as reuse (logged, RefreshTokenReuseDetected), and support can
// look at recent sessions. Past that they are only rows that never stop growing.
export const ENDED_SESSION_RETENTION_DAYS = 30;
const BATCH = 1_000;

export interface PurgedSessionsDto {
  readonly deleted: number;
}

// The daily sweep of iam.refresh_tokens. One batch per transaction, so the sweep never holds many
// row locks at once or one long transaction, and stops at the first batch that is not full.
export class PurgeEndedSessionsCommand extends Command<PurgedSessionsDto> {
  constructor(readonly batchSize: number = BATCH) {
    super();
  }
}

@CommandHandler(PurgeEndedSessionsCommand)
export class PurgeEndedSessionsHandler implements ICommandHandler<PurgeEndedSessionsCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: PurgeEndedSessionsCommand): Promise<PurgedSessionsDto> {
    const endedBefore = new Date(
      this.clock.now().getTime() - ENDED_SESSION_RETENTION_DAYS * DAY_MS,
    );
    let deleted = 0;
    for (;;) {
      const batch = await this.uow.run(() =>
        this.refreshTokens.deleteEndedBefore(endedBefore, command.batchSize),
      );
      deleted += batch;
      if (batch < command.batchSize) {
        return { deleted };
      }
    }
  }
}
