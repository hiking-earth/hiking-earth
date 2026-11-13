// Free CPU backend is the default. External providers require explicit opt-in.
const crypto = require('node:crypto');
function trustedInternalCall(value) {
 const expected=process.env.GEAR_SCAN_INTERNAL_TOKEN||'';
 if(!/^[a-f0-9]{64}$/.test(expected)||typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return false;
 return crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(value,'hex'));
}

exports.main=async event=>{
 if(!trustedInternalCall(event?.internalToken))return {errMsg:'照片识别服务未授权，请通过账号隐私设置后重试'};
 const {internalToken,...request}=event||{};
 const backend=process.env.GEAR_SCAN_BACKEND||'cpu';
 if(!['cpu','external'].includes(backend))return {errMsg:'照片识别后端配置无效，请联系管理员'};
 if(backend==='external')return require('./provider.cjs').main(request);
 try{return await require('./local-cpu.cjs').main(request);}catch{return {errMsg:'免费识别服务暂不可用，请稍后重试'};}
};
