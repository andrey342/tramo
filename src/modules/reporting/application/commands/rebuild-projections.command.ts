import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import {
  EVENT_HISTORY,
  type EventHistory,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';

import { REPORTING_STORE, type ReportingStore } from '../ports/reporting-ports';
import { ReportingProjector } from '../reporting-projector';

const PAGE = 500;

// The read models thrown away and rebuilt from the whole history of events, in the order they
// happened (ADR 019). One transaction: the dashboards keep answering with the old figures until
// it commits, and live consumers wait for it, then apply what they bring on top (idempotent).
// Returns how many events were applied.
export class RebuildProjectionsCommand extends Command<number> {}

@CommandHandler(RebuildProjectionsCommand)
export class RebuildProjectionsHandler implements ICommandHandler<RebuildProjectionsCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REPORTING_STORE) private readonly store: ReportingStore,
    @Inject(EVENT_HISTORY) private readonly history: EventHistory,
    private readonly projector: ReportingProjector,
  ) {}

  execute(): Promise<number> {
    return this.uow.run(async () => {
      await this.store.reset();
      let applied = 0;
      let after: string | null = null;
      for (;;) {
        const events = await this.history.read(ReportingProjector.EVENTS, after, PAGE);
        for (const event of events) {
          await this.projector.apply(event);
        }
        applied += events.length;
        if (events.length < PAGE) {
          return applied;
        }
        after = events.at(-1)?.eventId ?? null;
      }
    });
  }
}
