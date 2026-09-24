// A journey screen owns its requests, never the shared authenticated session.
export function createScopedSessionClient(session) {
  const requests = new Set();
  let closed = false;
  const cancel = () => { for (const request of requests) request.abort(); };
  return Object.freeze({
    async read(kind, {requested = false} = {}) {
      if (!requested) return {available: false, reason: 'not-requested'};
      if (closed || session.signal.aborted) return {available: false, reason: 'cancelled'};
      const request = new AbortController(); requests.add(request);
      try {
        const result = await session.read(kind, {requested: true, signal: request.signal});
        return request.signal.aborted ? {available: false, reason: 'cancelled'} : result;
      } finally { requests.delete(request); }
    },
    cancel,
    close() { closed = true; cancel(); },
  });
}
