// Per-request identity comes only from a verified server-side session.
const { AsyncLocalStorage } = require('async_hooks');
const identities = new AsyncLocalStorage();
exports.withIdentity = (identity, operation) => identities.run(identity, operation);
exports.currentIdentity = () => {
  const identity = identities.getStore();
  if (!identity) throw new Error('Authenticated identity required');
  return identity;
};
exports.optionalIdentity = () => identities.getStore() || '';
