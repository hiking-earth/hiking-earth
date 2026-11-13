/** setBackend can resolve false as well as reject on unsupported devices. */
export async function initializeGearBackend(runtime:{setBackend:(name:string)=>Promise<boolean>;ready:()=>Promise<void>}):Promise<void>{
 let accelerated=false;
 try{accelerated=await runtime.setBackend('webgl');}catch{/* Continue with the registered CPU backend. */}
 if(!accelerated){
  let cpu=false;
  try{cpu=await runtime.setBackend('cpu');}catch{/* Return a stable user-facing failure below. */}
  if(!cpu)throw new Error('当前设备无法启动本机识别，请换设备重试');
 }
 await runtime.ready();
}
