// Public catalog counters use a conditional atomic increment, avoiding a
// read/replace transaction for every page. Never reset an existing counter.
exports.createLimiter = ({ db, hash, fail, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) => {
  const ready = new Map();
  async function initialize(id, expiresAt) {
    const collection = db.collection('client_rate_limits');
    if ((await collection.doc(id).get()).data) return;
    try { await collection.add({ data: { _id:id, count:0, expiresAt } }); }
    catch (error) {
      // Another instance may have inserted the same unique document.
      // Re-read to prove existence; never use set(), which resets its count.
      if (!(await collection.doc(id).get()).data) throw error;
    }
  }
  return async (scope, max) => {
    const window = Math.floor(now() / (15 * 60 * 1000));
    const id = hash(`${scope}:${window}`);
    for (let attempt=0;attempt<3;attempt++) {
      try {
        if (!ready.has(id)) {
          const job=initialize(id,(window+2)*15*60*1000);
          ready.set(id,job);
          job.catch(()=>{if(ready.get(id)===job)ready.delete(id);});
          while(ready.size>256)ready.delete(ready.keys().next().value);
        }
        await ready.get(id);
        const result=await db.collection('client_rate_limits')
          .where({_id:id,count:db.command.lt(max)})
          .update({data:{count:db.command.inc(1)}});
        const updated=result?.stats?.updated ?? result?.updated;
        if (updated===0) fail('操作过于频繁，请稍后重试',429);
        if (updated!==1) throw new Error('Counter update not confirmed');
        return;
      } catch(error) {
        if(error?.status||attempt===2)throw error;
        await sleep(30*(attempt+1));
      }
    }
  };
};
