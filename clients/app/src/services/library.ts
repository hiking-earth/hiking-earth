import { accountSession } from './account-core';

// Automatic and user-triggered cloud operations share the same in-process
// queue so a manual restore cannot race an automatic save (or vice versa).
let libraryCloudQueue: Promise<void> = Promise.resolve();
let libraryCloudOperationActive = false;
let libraryCloudOperationWaiting = 0;
function lockRelease(unlock: () => void): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    libraryCloudOperationActive = false;
    unlock();
  };
}
export async function acquireLibraryCloudLock(): Promise<() => void> {
  const previous = libraryCloudQueue;
  let unlock!: () => void;
  libraryCloudQueue = new Promise<void>(resolve => { unlock = resolve; });
  libraryCloudOperationWaiting++;
  await previous;
  libraryCloudOperationWaiting--;
  libraryCloudOperationActive = true;
  return lockRelease(unlock);
}
/** Account migration is synchronous, so it must fail closed instead of racing a queued cloud operation. */
export function tryAcquireLibraryCloudLock(): (() => void) | null {
  if (libraryCloudOperationActive || libraryCloudOperationWaiting > 0) return null;
  let unlock!: () => void;
  libraryCloudQueue = new Promise<void>(resolve => { unlock = resolve; });
  libraryCloudOperationActive = true;
  return lockRelease(unlock);
}

export type TripPlan = { id: string; routeId: string; date: string; notes: string; packed: boolean };
export type Library = { favorites: string[]; plans: TripPlan[] };

// Keep each account's local copy separate. Older releases used one unscoped key;
// quarantine that snapshot and only expose it through an explicit user import.
const LEGACY_KEY = 'he_library_v1';
const QUARANTINE_KEY = 'he_library_legacy_unassigned_v1';
const DELETED_ARCHIVE_PREFIX = 'he_library_deleted_v2:';
const scopedKey = (owner: string) => `he_library_v2:${owner ? encodeURIComponent(owner) : 'anonymous'}`;
const deletedArchiveKey = (ownerHash: string) => `${DELETED_ARCHIVE_PREFIX}${ownerHash}`;

export function libraryOwner(): string {
  const session = accountSession();
  if (session) return session.openid;
  // The mini-program can authenticate directly with WeChat without a unified
  // account session; preserve its own cloud-library identity as a separate bucket.
  const saved = String(uni.getStorageSync('he_openid') || '');
  return saved && saved !== 'local-mock-user' && !saved.startsWith('account:') ? saved : '';
}

function emptyLibrary(): Library { return { favorites: [], plans: [] }; }
function parseLibrary(raw: unknown): Library | null {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    return {
      favorites: Array.isArray((data as any).favorites) ? (data as any).favorites.filter((v: unknown) => typeof v === 'string' && v.length <= 128).slice(0, 400) : [],
      plans: Array.isArray((data as any).plans) ? (data as any).plans.filter((p: any) => p && typeof p.id === 'string' && p.id.length <= 128
        && typeof p.routeId === 'string' && p.routeId.length <= 128 && typeof p.notes === 'string' && p.notes.length <= 2000
        && typeof p.date === 'string' && typeof p.packed === 'boolean').slice(0, 200) : [],
    };
  } catch { return null; }
}
function parseLibraryStrict(raw: unknown): Library | null {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || Object.keys(data).some(key => !['favorites', 'plans'].includes(key))
      || !Array.isArray((data as any).favorites) || !Array.isArray((data as any).plans)
      || (data as any).favorites.length > 400 || (data as any).plans.length > 200) return null;
    const favorites = (data as any).favorites;
    const plans = (data as any).plans;
    const validDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!favorites.every((value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 128)
      || new Set(favorites).size !== favorites.length
      || !plans.every((plan: any) => plan && typeof plan === 'object' && !Array.isArray(plan)
        && Object.keys(plan).length === 5 && ['id', 'routeId', 'date', 'notes', 'packed'].every(key => key in plan)
        && typeof plan.id === 'string' && plan.id.length > 0 && plan.id.length <= 128
        && typeof plan.routeId === 'string' && plan.routeId.length > 0 && plan.routeId.length <= 128
        && typeof plan.date === 'string' && typeof plan.notes === 'string' && plan.notes.length <= 2000
        && validDate(plan.date) && typeof plan.packed === 'boolean')
      || new Set(plans.map((plan: TripPlan) => plan.id)).size !== plans.length) return null;
    return { favorites: [...favorites], plans: plans.map((plan: TripPlan) => ({ ...plan })) };
  } catch { return null; }
}
function stableHash(value: string): string {
  let first = 0x811c9dc5, second = 0x27d4eb2d;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x5bd1e995);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
function mergeLibraries(primary: Library, incoming: Library, namespace: string): Library {
  const favorites = [...new Set([...primary.favorites, ...incoming.favorites])];
  const plans = primary.plans.map(plan => ({ ...plan }));
  const byId = new Map(plans.map(plan => [plan.id, plan]));
  for (const plan of incoming.plans) {
    const prior = byId.get(plan.id);
    if (!prior) { const copy = { ...plan }; plans.push(copy); byId.set(copy.id, copy); continue; }
    if (JSON.stringify(prior) === JSON.stringify(plan)) continue;
    const source = JSON.stringify(plan);
    for (let attempt = 0; ; attempt++) {
      const restoredId = `restored-${stableHash(`${namespace}\0${source}\0${attempt}`)}`;
      const copy = { ...plan, id: restoredId };
      const priorRestored = byId.get(restoredId);
      if (!priorRestored) { plans.push(copy); byId.set(restoredId, copy); break; }
      // A retry after successful data write but failed archive cleanup must
      // recognize the deterministic restored row and avoid creating another.
      if (JSON.stringify(priorRestored) === JSON.stringify(copy)) break;
    }
  }
  return { favorites, plans };
}
function readStrictAt(key: string): Library | null {
  const raw = uni.getStorageSync(key);
  return raw === undefined || raw === null || raw === '' ? emptyLibrary() : parseLibraryStrict(raw);
}
function quarantineLegacyLibrary(): void {
  try {
    const old = uni.getStorageSync(LEGACY_KEY);
    if (!old) return;
    const parsed = parseLibraryStrict(old);
    if (!parsed) return;
    const existing = readStrictAt(QUARANTINE_KEY);
    if (!existing) return;
    const merged = mergeLibraries(existing, parsed, 'legacy-import');
    if (merged.favorites.length > 400 || merged.plans.length > 200) return;
    const serialized = JSON.stringify(merged);
    uni.setStorageSync(QUARANTINE_KEY, serialized);
    if (JSON.stringify(parseLibraryStrict(uni.getStorageSync(QUARANTINE_KEY))) !== serialized) return;
    uni.removeStorageSync(LEGACY_KEY);
    if (uni.getStorageSync(LEGACY_KEY)) return;
  } catch { /* Preserve the old key if storage cannot safely copy it. */ }
}
function readAt(key: string): Library {
  const parsed = parseLibrary(uni.getStorageSync(key));
  return parsed || emptyLibrary();
}

/** Fail closed when the current account's saved snapshot cannot be parsed whole. */
export function currentLibraryStorageValid(): boolean {
  try {
    const raw = uni.getStorageSync(scopedKey(libraryOwner()));
    return raw === undefined || raw === null || raw === '' || parseLibraryStrict(raw) !== null;
  } catch { return false; }
}

export function readLibrary(): Library {
  quarantineLegacyLibrary();
  return readAt(scopedKey(libraryOwner()));
}
/** Merge only identities returned by the verified server-side account merge. */
export function mergeVerifiedAccountLibraries(sourceOwners: string[], targetOwner: string, lockHeld = false): boolean {
  if (!targetOwner || !Array.isArray(sourceOwners) || sourceOwners.length > 100
      || sourceOwners.some(owner => typeof owner !== 'string' || !owner || owner.length > 128)) return false;
  const releaseCloud = lockHeld ? null : tryAcquireLibraryCloudLock();
  if (!lockHeld && !releaseCloud) return false;
  try {
    const owners = [...new Set(sourceOwners)].filter(owner => owner !== targetOwner);
    const targetKey = scopedKey(targetOwner), target = readStrictAt(targetKey);
    if (!target) return false;
    let merged = target;
    const sourceKeys: string[] = [];
    for (const owner of owners) {
      const key = scopedKey(owner), raw = uni.getStorageSync(key);
      if (raw === undefined || raw === null || raw === '') continue;
      const incoming = parseLibraryStrict(raw);
      if (!incoming) return false;
      merged = mergeLibraries(merged, incoming, `verified-merge:${targetOwner}:${owner}`);
      sourceKeys.push(key);
    }
    if (merged.favorites.length > 400 || merged.plans.length > 200) return false;
    const serialized = JSON.stringify(merged);
    uni.setStorageSync(targetKey, serialized);
    if (JSON.stringify(parseLibraryStrict(uni.getStorageSync(targetKey))) !== serialized) return false;
    for (const key of sourceKeys) {
      uni.removeStorageSync(key);
      if (uni.getStorageSync(key) !== undefined && uni.getStorageSync(key) !== null && uni.getStorageSync(key) !== '') return false;
    }
    return true;
  } catch { return false; }
  finally { releaseCloud?.(); }
}
export function writeLibrary(data: Library): void {
  quarantineLegacyLibrary();
  const key = scopedKey(libraryOwner()), existingRaw = uni.getStorageSync(key);
  if (existingRaw !== undefined && existingRaw !== null && existingRaw !== '' && !parseLibraryStrict(existingRaw))
    throw new Error('本机收藏或行程资料格式异常，已阻止覆盖；请保留应用数据，待统一修复后处理');
  const parsed = parseLibraryStrict(data);
  if (!parsed) throw new Error('本机收藏与行程格式无效');
  const serialized = JSON.stringify(parsed);
  uni.setStorageSync(key, serialized);
  if (JSON.stringify(parseLibraryStrict(uni.getStorageSync(key))) !== serialized) throw new Error('本机资料保存回读不一致');
}
export function legacyLibrary(): Library | null {
  return legacyLibraryBackupStatus().library;
}
export function legacyLibraryBackupStatus(): { library: Library | null; invalid: boolean } {
  quarantineLegacyLibrary();
  const quarantined = uni.getStorageSync(QUARANTINE_KEY);
  const old = uni.getStorageSync(LEGACY_KEY);
  const hasValue = (value: unknown) => value !== undefined && value !== null && value !== '';
  const raw = hasValue(quarantined) ? quarantined : old;
  if (!hasValue(raw)) return { library: null, invalid: false };
  const library = parseLibraryStrict(raw);
  return { library, invalid: !library };
}
/** Explicitly merge the unassigned pre-account library into the currently selected local account. */
export function importLegacyLibrary(): { favorites: number; plans: number } {
  const legacy = legacyLibrary();
  if (!legacy) return { favorites: 0, plans: 0 };
  const current = readStrictAt(scopedKey(libraryOwner()));
  if (!current) throw new Error('当前本机资料格式异常，旧备份仍保留，请先导出或修复当前资料');
  const merged = mergeLibraries(current, legacy, 'legacy-import');
  if (merged.favorites.length > 400 || merged.plans.length > 200) throw new Error('合并后收藏或行程超过本机上限，请先整理当前资料');
  const targetKey = scopedKey(libraryOwner()), serialized = JSON.stringify(merged);
  uni.setStorageSync(targetKey, serialized);
  if (JSON.stringify(parseLibraryStrict(uni.getStorageSync(targetKey))) !== serialized) throw new Error('本机保存回读不一致，旧备份仍保留');
  // Remove the quarantined snapshot only after the scoped write succeeds.
  uni.removeStorageSync(QUARANTINE_KEY);
  if (uni.getStorageSync(QUARANTINE_KEY)) throw new Error('本机资料已合并，但旧备份清理未确认；可安全重试');
  return { favorites: legacy.favorites.length, plans: legacy.plans.length };
}

export type DeletedLibraryArchive = { id: string; favorites: number; plans: number; valid: boolean };
export function listDeletedLibraryArchives(): DeletedLibraryArchive[] {
  try {
    const keys = uni.getStorageInfoSync()?.keys;
    if (!Array.isArray(keys)) return [];
    return keys.filter((key: unknown): key is string => typeof key === 'string' && key.startsWith(DELETED_ARCHIVE_PREFIX))
      .map(key => ({ id: key.slice(DELETED_ARCHIVE_PREFIX.length), library: parseLibraryStrict(uni.getStorageSync(key)) }))
      .filter(item => /^[a-f0-9]{16}$/.test(item.id))
      .map(item => ({ id: item.id, favorites: item.library?.favorites.length || 0, plans: item.library?.plans.length || 0, valid: !!item.library }));
  } catch { return []; }
}

/** Recover one deleted account's local library without mixing it with other recovery archives. */
export function importDeletedLibraryArchive(id: string): { favorites: number; plans: number } {
  if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('待恢复资料编号无效');
  const archiveKey = deletedArchiveKey(id), archived = parseLibraryStrict(uni.getStorageSync(archiveKey));
  if (!archived) throw new Error('待恢复资料不存在或格式异常，备份未删除');
  const targetKey = scopedKey(libraryOwner()), current = readStrictAt(targetKey);
  if (!current) throw new Error('当前本机资料格式异常，恢复备份仍保留');
  const merged = mergeLibraries(current, archived, `deleted:${id}`);
  if (merged.favorites.length > 400 || merged.plans.length > 200) throw new Error('合并后超过本机容量上限；请先整理当前资料，备份仍保留');
  const serialized = JSON.stringify(merged);
  uni.setStorageSync(targetKey, serialized);
  if (JSON.stringify(parseLibraryStrict(uni.getStorageSync(targetKey))) !== serialized) throw new Error('本机恢复回读不一致，备份仍保留');
  uni.removeStorageSync(archiveKey);
  if (uni.getStorageSync(archiveKey)) throw new Error('资料已恢复，但备份清理未确认；可安全重试');
  return { favorites: archived.favorites.length, plans: archived.plans.length };
}

/** Move a deleted account's local-only library into its own recoverable archive. */
export function archiveDeletedAccountLibrary(owner: string): { status: 'archived' | 'empty' | 'failed'; favorites: number; plans: number; metadataCleaned: boolean } {
  if (!owner || owner === 'anonymous') return { status: 'failed', favorites: 0, plans: 0, metadataCleaned: false };
  const sourceKey = scopedKey(owner);
  const archiveKey = deletedArchiveKey(stableHash(owner));
  const valueExists = (value: unknown) => value !== undefined && value !== null && value !== '';
  const cleanMetadata = () => {
    let complete = true;
    for (const key of [`he_library_version:${owner}`, `he_library_baseline:${owner}`]) {
      try { uni.removeStorageSync(key); if (valueExists(uni.getStorageSync(key))) complete = false; } catch { complete = false; }
    }
    return complete;
  };
  try {
    const raw = uni.getStorageSync(sourceKey);
    if (!raw) {
      const archivedRaw = uni.getStorageSync(archiveKey);
      const archived = archivedRaw ? parseLibraryStrict(archivedRaw) : null;
      if (archivedRaw && !archived) return { status: 'failed', favorites: 0, plans: 0, metadataCleaned: false };
      return archived
        ? { status: 'archived', favorites: archived.favorites.length, plans: archived.plans.length, metadataCleaned: cleanMetadata() }
        : { status: 'empty', favorites: 0, plans: 0, metadataCleaned: cleanMetadata() };
    }
    const source = parseLibraryStrict(raw);
    if (!source) return { status: 'failed', favorites: 0, plans: 0, metadataCleaned: false };
    const existing = readStrictAt(archiveKey);
    if (!existing) return { status: 'failed', favorites: 0, plans: 0, metadataCleaned: false };
    const merged = mergeLibraries(existing, source, `deleted:${stableHash(owner)}`);
    if (merged.favorites.length > 400 || merged.plans.length > 200) return { status: 'failed', favorites: 0, plans: 0, metadataCleaned: false };
    const serialized = JSON.stringify(merged);
    uni.setStorageSync(archiveKey, serialized);
    if (JSON.stringify(parseLibraryStrict(uni.getStorageSync(archiveKey))) !== serialized) return { status: 'failed', favorites: 0, plans: 0, metadataCleaned: false };
    uni.removeStorageSync(sourceKey);
    if (valueExists(uni.getStorageSync(sourceKey))) return { status: 'failed', favorites: 0, plans: 0, metadataCleaned: false };
    return { status: 'archived', favorites: source.favorites.length, plans: source.plans.length, metadataCleaned: cleanMetadata() };
  } catch { return { status: 'failed', favorites: 0, plans: 0, metadataCleaned: false }; }
}

export function toggleFavorite(id: string): boolean {
  const data = readLibrary(), exists = data.favorites.includes(id);
  data.favorites = exists ? data.favorites.filter(x => x !== id) : [...data.favorites, id];
  if (data.favorites.length > 400) throw new Error('最多收藏400条路线');
  writeLibrary(data); return !exists;
}
export function libraryVersion(): number { return Number(uni.getStorageSync(`he_library_version:${libraryOwner()}`) || 0); }
/** Serialize library content with stable field order for sync baselines. */
export function librarySnapshot(snapshot: Library): string {
  const parsed = parseLibraryStrict(snapshot);
  if (!parsed) throw new Error('本机云资料格式无效');
  return JSON.stringify({
    favorites: parsed.favorites,
    plans: parsed.plans.map(plan => ({ id: plan.id, routeId: plan.routeId, date: plan.date, notes: plan.notes, packed: plan.packed })),
  });
}
export function setLibraryVersion(version: number, snapshot: Library = readLibrary()): void {
  const owner = libraryOwner();
  if (!owner) throw new Error('请先登录统一账号');
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('云资料版本无效，本机同步进度未更新');
  const baseline = librarySnapshot(snapshot);
  const versionKey = `he_library_version:${owner}`;
  const baselineKey = `he_library_baseline:${owner}`;
  // Persist the snapshot first and use the version as the commit marker. If
  // either write is interrupted, the next sync must not mistake partial local
  // metadata for a confirmed cloud state.
  uni.setStorageSync(baselineKey, baseline);
  if (uni.getStorageSync(baselineKey) !== baseline) throw new Error('同步基线保存回读不一致，本机同步进度未确认');
  uni.setStorageSync(versionKey, version);
  if (Number(uni.getStorageSync(versionKey)) !== version || uni.getStorageSync(baselineKey) !== baseline)
    throw new Error('云资料版本保存回读不一致，本机同步进度未确认');
}

/** Validate a cloud snapshot before replacing any local library data. */
export function validCloudLibrary(value: unknown): value is Library & { version: number } {
  const row = value as any;
  return !!row && Number.isSafeInteger(row.version) && row.version >= 0
    && Array.isArray(row.favorites) && row.favorites.length <= 400
    && row.favorites.every((id: unknown) => typeof id === 'string' && id.length > 0 && id.length <= 128)
    && new Set(row.favorites).size === row.favorites.length
    && Array.isArray(row.plans) && row.plans.length <= 200
    && row.plans.every((plan: any) => !!plan && typeof plan.id === 'string' && plan.id.length <= 128
      && plan.id.length > 0 && typeof plan.routeId === 'string' && plan.routeId.length > 0 && plan.routeId.length <= 128
      && typeof plan.notes === 'string' && plan.notes.length <= 2000 && typeof plan.packed === 'boolean'
      && typeof plan.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(plan.date)
      && Number.isFinite(Date.parse(plan.date)) && new Date(plan.date).toISOString().slice(0, 10) === plan.date)
    && new Set(row.plans.map((plan: any) => plan.id)).size === row.plans.length;
}
