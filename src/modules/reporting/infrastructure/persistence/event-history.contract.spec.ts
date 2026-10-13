import { uuidv7 } from 'uuidv7';

import { eventHistoryContract } from '../../../../../test/contracts/event-history.contract';
import { InMemoryEventHistory } from '../../../../../test/fakes/reporting';

eventHistoryContract('in-memory', () => {
  const history = new InMemoryEventHistory();
  return {
    history,
    record: (events) => {
      history.events.push(...events.map((event) => ({ ...event, eventId: uuidv7() })));
      return Promise.resolve();
    },
    run: (work) => work(),
  };
});
