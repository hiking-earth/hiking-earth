/** Shared limits for locally stored offline map data across the client platforms. */
export const OFFLINE_MAP_STORAGE_BUDGET_BYTES = 192 * 1024 * 1024;

export function assertOfflineMapCapacity(currentBytes: number, incomingBytes: number): void {
  if (!Number.isSafeInteger(currentBytes) || currentBytes < 0
      || !Number.isSafeInteger(incomingBytes) || incomingBytes < 0) {
    throw new Error('地图容量信息无效，请保留原包');
  }
  if (currentBytes + incomingBytes > OFFLINE_MAP_STORAGE_BUDGET_BYTES) {
    throw new Error('本机地图总量将超过192 MiB，请先删除不使用的地图');
  }
}
