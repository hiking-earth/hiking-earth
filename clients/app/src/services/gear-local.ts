// #ifdef H5 || APP-PLUS
import type * as coco from '@tensorflow-models/coco-ssd';
// #endif
export type LocalGearResult={items:{name:string;category:string}[];missing:{name:string;reason:string}[];usage:string[];plan:{name:string}[]};
const labels:Record<string,[string,string]>={
 backpack:['背包','背包'],handbag:['手提包（请确认用途）','其他'],suitcase:['行李箱（请确认用途）','其他'],
 bench:['步道长椅/露营凳候选（请确认用途）','休息'],chair:['露营椅候选（请确认类型）','休息'],bed:['铺位/睡垫候选（请确认物品）','睡眠'],'dining table':['露营桌候选（请确认用途）','炊具'],
 bottle:['瓶状物（请确认用途）','饮食'],cup:['杯子','饮食'],bowl:['碗','饮食'],knife:['刀具','工具'],fork:['叉子','饮食'],spoon:['勺子','饮食'],
 book:['地图或手册候选（请确认内容）','导航'],clock:['手表或计时器候选（请确认类型）','导航'],scissors:['剪刀状工具候选（请确认用途）','工具'],toothbrush:['牙刷候选','卫生'],
 'cell phone':['手机','导航'],umbrella:['雨伞','其他'],
 skis:['滑雪板候选','其他'],snowboard:['单板滑雪板候选','其他'],surfboard:['冲浪板候选','其他'],
 skateboard:['滑板候选','其他'],'tennis racket':['球拍候选','其他'],'baseball bat':['球棒候选','其他'],
 'baseball glove':['手套候选','其他'],'sports ball':['球类装备候选','其他'],frisbee:['飞盘候选','其他'],kite:['风筝候选','其他']
};
function formatCandidates(predictions:Array<{class:string;score:number}>){
 const best=new Map<string,number>();
 for(const prediction of predictions){
  if(!labels[prediction.class]||!Number.isFinite(prediction.score)||prediction.score<0||prediction.score>1)continue;
  if(prediction.score>(best.get(prediction.class)??-1))best.set(prediction.class,prediction.score);
 }
 return [...best.entries()].sort((a,b)=>b[1]-a[1]).map(([className,score])=>({name:`${labels[className][0]} · 候选 ${Math.round(score*100)}%`,category:labels[className][1]}));
}
// #ifdef H5 || APP-PLUS
type GearDetector = Pick<coco.ObjectDetection, 'detect'>;
let model:Promise<GearDetector>|undefined;
let tail:Promise<void>=Promise.resolve();
function gearModelUrl(){
 // #ifdef APP-PLUS
 return `${import.meta.env.BASE_URL}static/models/gear/model.json`;
 // #endif
 return `${import.meta.env.BASE_URL}models/gear/model.json`;
}
async function detector(){
 if(!model)model=(async()=>{
  // Keep the model runtime out of the normal client route bundle. Load it only
  // after the user has selected a photo and explicitly requested recognition.
  const [tf, , , cocoRuntime, backend]=await Promise.all([
   import('@tensorflow/tfjs-core'),
   import('@tensorflow/tfjs-backend-cpu'),
   import('@tensorflow/tfjs-backend-webgl'),
   import('@tensorflow-models/coco-ssd'),
   import('./gear-backend'),
  ]);
  await backend.initializeGearBackend(tf);
  return cocoRuntime.load({base:'lite_mobilenet_v2',modelUrl:gearModelUrl()});
 })().catch(error=>{model=undefined;throw error;});
 return model!;
}
// #endif
export async function analyzeGearLocally(path:string):Promise<LocalGearResult>{
 // #ifdef H5 || APP-PLUS
 const previous=tail;let release!:()=>void;tail=new Promise<void>(resolve=>{release=resolve;});await previous;
 let objectUrl='';
 try{
  if(!path.startsWith('blob:')&&!/^data:image\/(jpeg|png|webp|gif);base64,/.test(path))throw new Error('请从本机相册重新选择照片');
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);
  let blob:Blob;
  try{const response=await fetch(path,{signal:controller.signal});if(!response.ok)throw new Error('照片读取失败，请重新选择');blob=await response.blob();}catch(error){if(controller.signal.aborted)throw new Error('照片读取超时，请重新选择后重试');throw error;}finally{clearTimeout(timeout);}
  if(blob.size>4*1024*1024)throw new Error('请选择4 MB以内的照片');
  objectUrl=URL.createObjectURL(blob);const image=new Image();image.src=objectUrl;await image.decode();
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>24_000_000)throw new Error('图片尺寸过大，请压缩后重试');
  const scale=Math.min(1,300/image.naturalWidth,300/image.naturalHeight);
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d');if(!context)throw new Error('当前设备不支持本机图像分析');context.drawImage(image,0,0,canvas.width,canvas.height);
  const predictions=await(await detector()).detect(canvas,20,0.55);
  const items=formatCandidates(predictions);
  return {items,missing:[],usage:[items.length?'请逐项确认图像检测候选；概率不是正确率或质量认证。':'未检测到支持的装备类别，不表示照片中没有装备。','本机免费模型只识别有限通用物体候选；徒步鞋靴、登山杖、帐篷、睡袋和药品没有专用类别，请结合路线装备清单手动核对。床类仅提供铺位/睡垫候选，不表示识别出睡袋。','模型不能判断衣物材质、装备性能或完整性。如已选择路线，清单按路线、出发日期和负重方式生成；天气只在可用的当日坐标预报范围内补充。'],plan:['饮用水及补给','适合路面的鞋袜','防雨及保暖层','离线轨迹及备用电源','急救用品','头灯','紧急联系方式'].map(name=>({name}))};
 }finally{if(objectUrl)URL.revokeObjectURL(objectUrl);release();}
 // #endif
 // #ifndef H5
 throw new Error('当前平台尚未提供本机图像检测');
 // #endif
}
