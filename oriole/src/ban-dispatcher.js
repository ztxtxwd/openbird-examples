export function getBanQueueKey(event) {
  const data = event?.data ?? {};
  return data.thread_id ?? data.message_id ?? null;
}

export function createBanDispatcher({ run }) {
  const tails = new Map();

  async function dispatch(event) {
    const queueKey = getBanQueueKey(event);
    if (!queueKey) {
      throw new Error('Ban dispatch requires thread_id or message_id');
    }

    const previous = tails.get(queueKey);
    const current = (async () => {
      if (previous) {
        try {
          await previous;
        } catch {
          // swallow previous failure to keep queue moving
        }
      }
      return run({ event, queueKey });
    })();

    const tracked = current.finally(() => {
      if (tails.get(queueKey) === tracked) {
        tails.delete(queueKey);
      }
    });

    tails.set(queueKey, tracked);
    return tracked;
  }

  return { dispatch };
}
