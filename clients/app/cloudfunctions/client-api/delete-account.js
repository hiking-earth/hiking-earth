// Resumable deletion: disable business access first, remove at most 100 records
// per request, retain a password-verified resume path until cleanup completes.
const { assertNoForeignIdentityOwners, readIdentityRegistryVersion, lockIdentityRegistry } = require('./identity-ownership');

exports.deleteAccount = async (db, account, tokenHash) => {
  const rawAliases = account.identityAliases === undefined ? [] : account.identityAliases;
  if (!Array.isArray(rawAliases) || rawAliases.length > 100
      || rawAliases.some(value => typeof value !== 'string' || !value || value.length > 128)) {
    throw new Error('账号历史身份资料格式异常，注销已暂停以免遗漏云端数据');
  }
  const identities = [...new Set([account.identity, ...rawAliases])];
  if (typeof account.identity !== 'string' || !account.identity || account.identity.length > 128 || identities.length > 101) {
    throw new Error('账号历史身份数量超过注销安全上限，请联系管理员核对');
  }
  const accountId = require('crypto').createHash('sha256').update(account.username).digest('hex');
  const identityRegistryVersion = await readIdentityRegistryVersion(db);
  await assertNoForeignIdentityOwners(db, db.command, [
    { accountId, identity: account.identity, identityAliases: rawAliases },
  ]);
  const deletionState = await db.runTransaction(async tx => {
    const currentRef = tx.collection('client_accounts').doc(accountId);
    const latest = (await currentRef.get()).data;
    const latestAliases = latest?.identityAliases === undefined ? [] : latest.identityAliases;
    const sameAliases = Array.isArray(latestAliases)
      && JSON.stringify([...new Set(latestAliases)]) === JSON.stringify([...new Set(rawAliases)]);
    if (!latest || latest.disabled || latest.passwordHash !== account.passwordHash
        || latest.sessionVersion !== account.sessionVersion || latest.identity !== account.identity
        || !sameAliases || latest.merging || latest.mergeJobId) {
      throw new Error('Account changed during deletion');
    }
    const operations = (latest.operations || []).filter(item => item.until > Date.now());
    if (!latest.deleting) {
      await lockIdentityRegistry(tx, identityRegistryVersion);
      await currentRef.update({ data: { deleting: true, deletionStartedAt: Date.now(), sessionVersion: latest.sessionVersion + 1, operations } });
      await tx.collection('client_sessions').doc(tokenHash).update({ data: { sessionVersion: latest.sessionVersion + 1 } });
    }
    return { waiting: operations.length > 0,
      sessionVersion: latest.sessionVersion + (latest.deleting ? 0 : 1) };
  });
  if (deletionState.waiting) return { complete: false, waiting: true };
  let budget = 100;
  // Revoke pending device QR approvals and unused WeChat exchange tickets as
  // soon as deletion starts, before continuing with larger user data sets.
  for (const collection of ['client_qr_logins', 'client_wechat_tickets']) {
    const rows = (await db.collection(collection).where({ accountId }).limit(budget).get()).data;
    for (const row of rows) {
      await db.collection(collection).doc(row._id).remove();
      if (--budget <= 0) return { complete: false };
    }
  }
  for (const identity of identities) {
    await db.collection('team_members').where({ openid: identity }).update({ data: { latitude: null, longitude: null, updatedAt: 0 } });
    await db.collection('companion_posts').where({ openid: identity }).update({ data: { status: 'deleting' } });
    const ownTeams = (await db.collection('teams').where({ createdBy: identity, active: true }).limit(100).get()).data;
    for (const team of ownTeams) {
      await db.collection('teams').doc(team._id).update({ data: { active: false, closedAt: Date.now() } });
      await db.collection('team_members').where({ teamId: team._id }).update({ data: { latitude: null, longitude: null, updatedAt: 0 } });
      if (--budget <= 0) return { complete: false };
    }
    const membership = (await db.collection('team_members').where({ openid: identity }).limit(budget).get()).data;
    for (const member of membership) {
      await db.runTransaction(async tx => {
        const memberRef = tx.collection('team_members').doc(member._id);
        if (!(await memberRef.get()).data) return;
        const teamRef = tx.collection('teams').doc(member.teamId), team = (await teamRef.get()).data;
        await memberRef.remove();
        if (team && Number.isFinite(team.memberCount)) await teamRef.update({ data: { memberCount: Math.max(0, team.memberCount - 1) } });
      });
      if (--budget <= 0) return { complete: false };
    }
    // Remove participation before deleting owned posts. Version increments keep
    // existing conditional join requests from restoring an old member array.
    const participation = (await db.collection('companion_posts').where({ members: identity }).limit(budget).get()).data;
    for (const post of participation) {
      await db.runTransaction(async tx => {
        const postRef = tx.collection('companion_posts').doc(post._id), latest = (await postRef.get()).data;
        if (!latest) return;
        const members = (latest.members || []).filter(id => id !== identity);
        await postRef.update({ data: { members, joinVersion: (latest.joinVersion || 0) + 1,
          status: !['open', 'full'].includes(latest.status) ? latest.status : members.length >= latest.maxMembers ? 'full' : 'open' } });
      });
      if (--budget <= 0) return { complete: false };
    }
    const mapOwnerId = require('crypto').createHash('sha256').update(identity).digest('hex');
    const mapRequests = (await db.collection('offline_map_requests').where({ ownerId: mapOwnerId }).limit(budget).get()).data;
    for (const request of mapRequests) {
      await db.collection('offline_map_requests').doc(request._id).remove();
      if (--budget <= 0) return { complete: false };
    }
    const mapLimits = (await db.collection('offline_map_request_limits').where({ ownerId: mapOwnerId }).limit(budget).get()).data;
    for (const limit of mapLimits) {
      await db.collection('offline_map_request_limits').doc(limit._id).remove();
      if (--budget <= 0) return { complete: false };
    }
    for (const [collection, field] of [['user_documents', 'owner'], ['team_messages', 'owner'], ['user_notifications', 'owner'], ['user_libraries', 'owner'], ['tracks', 'owner'], ['sos_events', 'openid'], ['companion_posts', 'openid'], ['community_reports', 'reporter'], ['teams', 'createdBy']]) {
      const rows = (await db.collection(collection).where({ [field]: identity }).limit(budget).get()).data;
      for (const row of rows) {
        if (collection === 'companion_posts') {
          const registrations = (await db.collection('user_documents').where({ kind: 'registration', postId: row._id }).limit(budget).get()).data;
          for (const registration of registrations) {
            await db.collection('user_documents').doc(registration._id).remove();
            if (--budget <= 0) return { complete: false };
          }
        }
        await db.collection(collection).doc(row._id).remove();
        if (--budget <= 0) return { complete: false };
      }
    }
    // Route review records are shared public-status data, so retain each route
    // record while removing the deleted account's reviewer identifier.
    const reviews = (await db.collection('route_reviews').where({ reviewedBy: identity }).limit(budget).get()).data || [];
    for (const review of reviews) {
      await db.runTransaction(async tx => {
        const ref = tx.collection('route_reviews').doc(review._id);
        const current = (await ref.get()).data;
        if (!current || current.reviewedBy !== identity) return;
        const version = current.version === undefined ? 0 : current.version;
        if (!Number.isSafeInteger(version) || version < 0) {
          throw new Error('路线审核版本资料异常，注销已暂停以保护路线记录');
        }
        await ref.update({ data: { reviewedBy: '', version: version + 1 } });
      });
      if (--budget <= 0) return { complete: false };
    }
  }
  // Remove every linked identity by account id, including secondary or legacy
  // mappings that are not represented on the account profile itself.
  for (const collection of ['client_phone_identity_links', 'client_wechat_identity_links']) {
    const links = (await db.collection(collection).where({ accountId }).limit(budget).get()).data;
    for (const link of links) {
      await db.collection(collection).doc(link._id).remove();
      if (--budget <= 0) return { complete: false };
    }
  }
  // Remove private merge snapshots and any overflow library archives owned by
  // this canonical account; these may contain identities and user trip data.
  for (const collection of ['client_account_merges', 'client_account_merge_library_archives']) {
    const rows = (await db.collection(collection).where({ targetAccountId: accountId }).limit(budget).get()).data;
    for (const row of rows) {
      await db.collection(collection).doc(row._id).remove();
      if (--budget <= 0) return { complete: false };
    }
  }
  // Remove stale sessions in bounded batches while the current deletion session
  // remains resumable. A single unbounded remove after disabling the account
  // could fail midway and strand an account that can no longer resume cleanup.
  const sessions = (await db.collection('client_sessions').where({ accountId }).limit(budget).get()).data || [];
  for (const session of sessions) {
    if (session._id !== tokenHash) await db.collection('client_sessions').doc(session._id).remove();
    if (--budget <= 0) return { complete: false };
  }
  const remainingSessions = (await db.collection('client_sessions').where({ accountId }).limit(2).get()).data || [];
  if (remainingSessions.some(session => session._id !== tokenHash)) return { complete: false };

  const finalIdentityRegistryVersion = await readIdentityRegistryVersion(db);
  // Atomically stop the account and remove the final resume session. The
  // hashed document ID prevents username reuse without retaining its raw value.
  await db.runTransaction(async tx => {
    await lockIdentityRegistry(tx, finalIdentityRegistryVersion);
    const currentRef = tx.collection('client_accounts').doc(accountId);
    const latest = (await currentRef.get()).data;
    const sessionRef = tx.collection('client_sessions').doc(tokenHash);
    const currentSession = (await sessionRef.get()).data;
    const latestAliases = latest?.identityAliases === undefined ? [] : latest.identityAliases;
    const sameAliases = Array.isArray(latestAliases)
      && JSON.stringify([...new Set(latestAliases)]) === JSON.stringify([...new Set(rawAliases)]);
    if (!latest || !latest.deleting || latest.disabled || latest.sessionVersion !== deletionState.sessionVersion
        || latest.identity !== account.identity || !sameAliases || !currentSession || currentSession.accountId !== accountId
        || currentSession.sessionVersion !== latest.sessionVersion) {
      throw new Error('Account changed before deletion could finish');
    }
    await currentRef.set({ data: { disabled: true, deletedAt: Date.now(), sessionVersion: latest.sessionVersion + 1 } });
    await sessionRef.remove();
  });
  return { complete: true };
};
