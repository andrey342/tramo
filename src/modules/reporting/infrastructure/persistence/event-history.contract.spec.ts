import { uuidv7 } from 'uuidv7';

import { eventHistoryContract } from '../../../../../test/contracts/event-history.contract';
import { InMemoryEventHistory } from '../../../../../test/fakes/reporting';

eventHistoryContract('in-memory', () => {
  const history = new InMemoryEventHistory();
  return {
    history,
    // Each new batch goes in front, the way rows of later transactions can come back first from
    // a table: the history must still read them in id order.
    record: (events) => {
      history.events.unshift(...events.map((event) => ({ ...event, eventId: uuidv7() })));
      return Promise.resolve();
    },
    run: (work) => work(),
  };
});
