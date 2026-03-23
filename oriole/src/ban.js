import { createBanDispatcher } from './ban-dispatcher.js';
import { runBan } from './ban-runner.js';

export function createBan(deps = {}) {
  const dispatcher = createBanDispatcher({
    run: ({ event }) => runBan({ ...deps, event }),
  });

  return {
    dispatch(event) {
      return dispatcher.dispatch(event);
    },
  };
}

