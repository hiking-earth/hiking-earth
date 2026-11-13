/** Desktop bridge exists only in the bundled Tauri window. */
type DesktopWindow = Window & { __TAURI__?: { core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> } } };
export function isDesktop(): boolean {
  // #ifdef H5
  return typeof window !== 'undefined' && !!(window as DesktopWindow).__TAURI__?.core;
  // #endif
  // #ifndef H5
  return false;
  // #endif
}
export async function chooseDesktopGpx(): Promise<string | null> {
  // #ifdef H5
  if (isDesktop()) return (window as DesktopWindow).__TAURI__!.core.invoke<string | null>('choose_gpx');
  // #endif
  throw new Error('当前平台不支持桌面文件选择');
}
export async function saveDesktopGpx(name: string, content: string): Promise<boolean> {
  // #ifdef H5
  if (isDesktop()) return (window as DesktopWindow).__TAURI__!.core.invoke<boolean>('save_gpx', { name, content });
  // #endif
  throw new Error('当前平台不支持桌面文件保存');
}
export async function saveDesktopText(name: string, content: string): Promise<boolean> {
  // #ifdef H5
  if (isDesktop()) return (window as DesktopWindow).__TAURI__!.core.invoke<boolean>('save_local_text', { name, content });
  // #endif
  throw new Error('当前平台不是桌面客户端');
}
export async function checkDesktopUpdate(): Promise<{version:string;notes:string} | null> {
  // #ifdef H5
  if(isDesktop())try{return await (window as DesktopWindow).__TAURI__!.core.invoke('check_app_update');}catch(error){throw desktopUpdateError(error,'无法检查更新，请稍后重试');}
  // #endif
  throw new Error('当前平台不是桌面客户端');
}
export async function installDesktopUpdate(version:string): Promise<void> {
  // #ifdef H5
  if(isDesktop())try{return await (window as DesktopWindow).__TAURI__!.core.invoke('install_app_update',{version});}catch(error){throw desktopUpdateError(error,'更新失败，现有版本保持不变');}
  // #endif
  throw new Error('当前平台不是桌面客户端');
}

function desktopUpdateError(error:unknown,fallback:string):Error {
  const known=['更新服务不可用','无法检查更新，请稍后重试','更新状态不可用','更新已变化，请重新检查','请先检查更新','更新失败，签名或网络校验未通过；现有版本保持不变'];
  return new Error(typeof error==='string'&&known.includes(error)?error:fallback);
}
export async function restartDesktop(): Promise<void> {
  // #ifdef H5
  if(isDesktop())return (window as DesktopWindow).__TAURI__!.core.invoke('restart_app');
  // #endif
}

export async function requestDesktopMapCatalog():Promise<string>{
 if(!isDesktop())throw new Error('当前平台不是桌面客户端');
 return (window as DesktopWindow).__TAURI__!.core.invoke<string>('map_catalog');
}
export async function requestDesktopMapDownload(name:string,bytes:number):Promise<ArrayBuffer>{
 if(!isDesktop())throw new Error('当前平台不是桌面客户端');
 try{return await (window as DesktopWindow).__TAURI__!.core.invoke<ArrayBuffer>('map_download',{name,bytes});}
 catch(error){
  const known=['地图网络请求正在进行，请稍后重试','地图网络服务不可用','地图请求失败','地图请求未成功','地图响应大小不一致','地图下载中断','地图响应超过限制','地图下载不完整','地图下载清单无效'];
  throw new Error(typeof error==='string'&&known.includes(error)?error:'桌面地图调用失败');
 }
}
