/**
 * Tencent/WeChat native map style ID. The ID is public presentation config,
 * not an API key; keep Tencent service credentials out of the client bundle.
 */
const configuredStyle = String(import.meta.env.VITE_WECHAT_MAP_LAYER_STYLE || '').trim();

export const WECHAT_MAP_LAYER_STYLE: number | string =
  /^[A-Za-z0-9_-]{1,64}$/.test(configuredStyle) ? configuredStyle : 1;
