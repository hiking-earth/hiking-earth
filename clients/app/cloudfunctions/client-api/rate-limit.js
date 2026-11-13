// Serialize counters within an instance; bounded transaction retries also
// handle competing instances. An uncertain commit may consume an extra slot,
// but must never permit a request without a successful transaction.
exports.createLimiter = ({ db, hash, fail, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) => {
  const pending = new Map();
  return async (scope, max) => {
    const window = Math.floor(now() / (15 * 60 * 1000));
    const id = hash(`${scope}:${window}`);
    const previous = pending.get(id) || Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await db.runTransaction(async tx => {
            const ref = tx.collection('client_rate_limits').doc(id);
            const prior = (await ref.get()).data;
            if ((prior?.count || 0) >= max) fail('操作过于频繁，请稍后重试', 429);
            await ref.set({ data: { count: (prior?.count || 0) + 1, expiresAt: (window + 2) * 15 * 60 * 1000 } });
          });
          return;
        } catch (error) {
          if (error.status || attempt === 2) throw error;
          await sleep(30 * (attempt + 1));
        }
      }
    });
    pending.set(id, job);
    try { await job; } finally { if (pending.get(id) === job) pending.delete(id); }
  };
};
