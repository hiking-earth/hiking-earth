export type PrivacyConsentKey = "location" | "backgroundLocation" | "teamLocation" | "trackCloudSync" | "gearImageUpload";
export type PrivacyConsents = Record<PrivacyConsentKey, boolean>;

const listeners = new Set<(consents: PrivacyConsents) => void>();
const forcedOffInMemory = new Set<string>();
const ACCOUNT_CLOUD_CONSENTS = new Set<PrivacyConsentKey>(["teamLocation", "trackCloudSync", "gearImageUpload"]);
const PENDING_REVOCATION_PREFIX = "he_cloud_consent_revoke_pending_v1:";

function currentOwner(): string {
  try { return String(uni.getStorageSync('he_openid') || 'anonymous'); }
  catch { return 'anonymous'; }
}
function forcedOffKey(owner: string, key: PrivacyConsentKey): string { return `${owner}\u0000${key}`; }
function hasPendingCloudRevocation(owner: string, key: PrivacyConsentKey): boolean {
  if (!ACCOUNT_CLOUD_CONSENTS.has(key)) return false;
  try {
    const saved = uni.getStorageSync(`${PENDING_REVOCATION_PREFIX}${encodeURIComponent(owner)}:${key}`);
    return saved === true || (saved !== false && saved !== '' && saved !== null && saved !== undefined);
  } catch { return true; }
}

export function onPrivacyChange(listener: (consents: PrivacyConsents) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const STORAGE_PREFIX = "he_privacy_consents_v2:";
const DEFAULT_CONSENTS: PrivacyConsents = {
  location: false,
  backgroundLocation: false,
  teamLocation: false,
  trackCloudSync: false,
  gearImageUpload: false,
};

export function getPrivacyConsents(): PrivacyConsents {
  try {
    const owner=currentOwner();
    const saved = uni.getStorageSync(`${STORAGE_PREFIX}${encodeURIComponent(owner)}`);
    if (!saved || typeof saved !== "object") return { ...DEFAULT_CONSENTS };
    const consents: PrivacyConsents = {
      location: saved.location === true,
      backgroundLocation: saved.backgroundLocation === true,
      teamLocation: saved.teamLocation === true,
      trackCloudSync: saved.trackCloudSync === true,
      gearImageUpload: saved.gearImageUpload === true,
    };
    for (const key of ACCOUNT_CLOUD_CONSENTS) {
      if (hasPendingCloudRevocation(owner, key)) consents[key] = false;
    }
    return consents;
  } catch {
    return { ...DEFAULT_CONSENTS };
  }
}

export function hasPrivacyConsent(key: PrivacyConsentKey): boolean {
  return !forcedOffInMemory.has(forcedOffKey(currentOwner(), key)) && getPrivacyConsents()[key];
}

/** Fail closed for the current process when persistent consent writes fail. */
export function forcePrivacyConsentOff(key: PrivacyConsentKey): void {
  const owner = currentOwner();
  forcedOffInMemory.add(forcedOffKey(owner, key));
  const snapshot = { ...getPrivacyConsents(), [key]: false };
  for (const listener of [...listeners]) {
    try { listener(snapshot); }
    catch { console.warn('[privacy] consent-change callback failed'); }
  }
}

export function setPrivacyConsent(key: PrivacyConsentKey, enabled: boolean): PrivacyConsents {
  const owner=currentOwner();
  if(enabled&&hasPendingCloudRevocation(owner,key))throw new Error('账号级云端授权仍有待确认的撤回，确认前不能重新启用');
  const next = { ...getPrivacyConsents(), [key]: enabled };
  try { uni.setStorageSync(`${STORAGE_PREFIX}${encodeURIComponent(owner)}`, next); }
  catch (error) {
    forcePrivacyConsentOff(key);
    throw error;
  }
  const deniedKey = forcedOffKey(owner, key);
  if (enabled) forcedOffInMemory.delete(deniedKey);
  else forcedOffInMemory.add(deniedKey);
  // One module's cleanup callback must not prevent other services from seeing
  // a consent revocation after the new value has already been saved.
  for (const listener of [...listeners]) {
    try { listener(next); }
    catch { console.warn('[privacy] consent-change callback failed'); }
  }
  return next;
}
