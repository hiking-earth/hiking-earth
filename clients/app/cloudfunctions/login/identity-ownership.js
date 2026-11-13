const IDENTITY_BATCH_SIZE = 50;
const QUERY_PAGE_SIZE = 100;
const MAX_SCANNED_OWNERS = 500;
const IDENTITY_REGISTRY_COLLECTION = 'client_identity_registry';
const IDENTITY_REGISTRY_ID = 'global';

function identityOwnershipError(code, message) {
  const error = new Error(message);
  error.status = 409;
  error.code = code;
  return error;
}

/**
 * Reject identities already claimed by accounts outside this operation.
 * Call this on the database handle before opening a transaction: CloudBase
 * transactions support document operations but not collection where queries.
 * The query is deliberately bounded and fails closed if the matching owner
 * set is too large to inspect safely.
 */
async function assertNoForeignIdentityOwners(queryDb, command, owners) {
  if (!queryDb || !command || typeof command.in !== 'function' || !Array.isArray(owners)) {
    throw identityOwnershipError('IDENTITY_OWNER_CHECK_UNAVAILABLE', '无法核对身份归属，操作已暂停以保护账号资料');
  }
  const allowedAccountIds = new Set();
  const identities = new Set();
  for (const owner of owners) {
    if (!owner || !/^[a-f0-9]{64}$/.test(owner.accountId || '')
        || typeof owner.identity !== 'string' || !owner.identity || owner.identity.length > 128) {
      throw identityOwnershipError('IDENTITY_OWNER_DATA_INVALID', '账号身份资料格式异常，操作已暂停以保护账号资料');
    }
    const aliases = owner.identityAliases === undefined ? [] : owner.identityAliases;
    if (!Array.isArray(aliases) || aliases.length > 100
        || aliases.some(identity => typeof identity !== 'string' || !identity || identity.length > 128)) {
      throw identityOwnershipError('IDENTITY_OWNER_DATA_INVALID', '账号历史身份资料格式异常，操作已暂停以保护账号资料');
    }
    allowedAccountIds.add(owner.accountId);
    identities.add(owner.identity);
    for (const identity of aliases) identities.add(identity);
  }
  if (identities.size > 129 || !identities.size) {
    throw identityOwnershipError('IDENTITY_OWNER_SCAN_LIMIT', '身份资料数量超出安全核对范围，操作已暂停');
  }

  const identityList = [...identities];
  for (let start = 0; start < identityList.length; start += IDENTITY_BATCH_SIZE) {
    const batch = identityList.slice(start, start + IDENTITY_BATCH_SIZE);
    for (const field of ['identity', 'identityAliases']) {
      let offset = 0;
      while (true) {
        if (offset >= MAX_SCANNED_OWNERS) {
          throw identityOwnershipError('IDENTITY_OWNER_SCAN_LIMIT', '匹配账号过多，无法安全核对身份归属，操作已暂停');
        }
        const result = await queryDb.collection('client_accounts')
          .where({ [field]: command.in(batch) })
          .orderBy('_id', 'asc')
          .skip(offset)
          .limit(QUERY_PAGE_SIZE)
          .get();
        const rows = Array.isArray(result?.data) ? result.data : [];
        for (const row of rows) {
          if (!row || !allowedAccountIds.has(row._id)) {
            throw identityOwnershipError('IDENTITY_OWNER_COLLISION', '所涉身份已由其他账号持有，操作已暂停以保护双方资料');
          }
        }
        if (rows.length < QUERY_PAGE_SIZE) break;
        offset += rows.length;
      }
    }
  }
  return true;
}

/**
 * Read the version before scanning accounts. Transactions cannot run the
 * collection queries above, so writers recheck and increment this one shared
 * document inside their transaction. A competing identity mutation changes
 * the version and makes a stale preflight fail closed.
 */
async function readIdentityRegistryVersion(queryDb) {
  if (!queryDb) {
    throw identityOwnershipError('IDENTITY_REGISTRY_UNAVAILABLE', '无法核对身份变更状态，操作已暂停以保护账号资料');
  }
  const registry = (await queryDb.collection(IDENTITY_REGISTRY_COLLECTION).doc(IDENTITY_REGISTRY_ID).get()).data;
  const version = registry === undefined ? 0 : registry?.version;
  if (!Number.isSafeInteger(version) || version < 0) {
    throw identityOwnershipError('IDENTITY_REGISTRY_INVALID', '身份变更记录格式异常，操作已暂停以保护账号资料');
  }
  return version;
}

async function lockIdentityRegistry(tx, expectedVersion) {
  if (!tx || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    throw identityOwnershipError('IDENTITY_REGISTRY_INVALID', '身份变更记录格式异常，操作已暂停以保护账号资料');
  }
  const ref = tx.collection(IDENTITY_REGISTRY_COLLECTION).doc(IDENTITY_REGISTRY_ID);
  const registry = (await ref.get()).data;
  const currentVersion = registry === undefined ? 0 : registry?.version;
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
    throw identityOwnershipError('IDENTITY_REGISTRY_INVALID', '身份变更记录格式异常，操作已暂停以保护账号资料');
  }
  if (currentVersion !== expectedVersion) {
    throw identityOwnershipError('IDENTITY_OWNER_RECHECK_REQUIRED', '账号身份在核对期间发生变化，请重新开始操作');
  }
  await ref.set({ data: { version: currentVersion + 1, updatedAt: Date.now() } });
}

module.exports = { assertNoForeignIdentityOwners, readIdentityRegistryVersion, lockIdentityRegistry };
