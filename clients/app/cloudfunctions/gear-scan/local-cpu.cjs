const path=require('node:path');
let detector,busy=false;
const labels={
 backpack:['背包','背包'],handbag:['手提包（请确认用途）','其他'],suitcase:['行李箱（请确认用途）','其他'],
 bench:['步道长椅/露营凳候选（请确认用途）','休息'],chair:['露营椅候选（请确认类型）','休息'],bed:['铺位/睡垫候选（请确认物品）','睡眠'],'dining table':['露营桌候选（请确认用途）','炊具'],
 bottle:['瓶状物（请确认用途）','饮食'],cup:['杯子','饮食'],bowl:['碗','饮食'],knife:['刀具','工具'],fork:['叉子','饮食'],spoon:['勺子','饮食'],
 book:['地图或手册候选（请确认内容）','导航'],clock:['手表或计时器候选（请确认类型）','导航'],scissors:['剪刀状工具候选（请确认用途）','工具'],toothbrush:['牙刷候选','卫生'],
 'cell phone':['手机','导航'],umbrella:['雨伞','其他'],
 skis:['滑雪板候选','其他'],snowboard:['单板滑雪板候选','其他'],surfboard:['冲浪板候选','其他'],
 skateboard:['滑板候选','其他'],'tennis racket':['球拍候选','其他'],'baseball bat':['球棒候选','其他'],
 'baseball glove':['手套候选','其他'],'sports ball':['球类装备候选','其他'],frisbee:['飞盘候选','其他'],kite:['风筝候选','其他']
};
function formatCandidates(predictions){
 const best=new Map();
 for(const prediction of predictions){
  if(!labels[prediction.class]||!Number.isFinite(prediction.score)||prediction.score<0||prediction.score>1)continue;
  if(prediction.score>(best.get(prediction.class)??-1))best.set(prediction.class,prediction.score);
 }
 return [...best.entries()].sort((a,b)=>b[1]-a[1]).map(([className,score])=>({name:`${labels[className][0]} · 候选 ${Math.round(score*100)}%`,category:labels[className][1]}));
}
function decodeImage(bytes){
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return require('jpeg-js').decode(bytes,{useTArray:true,maxResolutionInMP:4,maxMemoryUsageInMB:64});
 const png=Buffer.from([137,80,78,71,13,10,26,10]);
 if(bytes.length>=24&&bytes.subarray(0,8).equals(png)&&bytes.toString('ascii',12,16)==='IHDR'){
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width*height>4000000)throw Error('Image size');
  return require('pngjs').PNG.sync.read(bytes,{checkCRC:true});
 }
 throw Error('Unsupported image');
}
exports.main=async event=>{
 const image=event?.image;
 if(typeof image!=='string'||image.length>Math.ceil(4*1024*1024/3)*4||image.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(image))return {errMsg:'请选择4 MB以内的JPEG或PNG照片'};
 if(busy)return {errMsg:'识别服务正在处理其他照片，请稍后重试'};
 busy=true;
 try{
  const bytes=Buffer.from(image,'base64');if(bytes.length>4*1024*1024||bytes.toString('base64')!==image)return {errMsg:'照片编码无效或过大'};
  let decoded;try{decoded=decodeImage(bytes);}catch{return {errMsg:'请使用400万像素以内的JPEG或PNG照片；其他格式请先转换'};}
  if(!decoded.width||!decoded.height||decoded.width*decoded.height>4000000)return {errMsg:'照片尺寸过大，请压缩后重试'};
  const rgb=new Uint8Array(300*300*3);
  for(let y=0;y<300;y++)for(let x=0;x<300;x++){const from=(Math.floor(y*decoded.height/300)*decoded.width+Math.floor(x*decoded.width/300))*4;rgb.set(decoded.data.subarray(from,from+3),(y*300+x)*3);}
  if(!detector){const tf=require('@tensorflow/tfjs-core');require('@tensorflow/tfjs-backend-cpu');detector=require('./cpu-detector.cjs').createCpuDetector({tf,coco:require('@tensorflow-models/coco-ssd'),modelDirectory:path.join(__dirname,'model')});}
  const predictions=await detector(rgb);
  const items=formatCandidates(predictions);
  return {provider:'cloud-cpu',items,missing:[],usage:[items.length?'请逐项确认图像检测候选；分数不是准确率或质量认证。':'未检测到支持类别，不表示照片中没有装备。','免费自托管模型只识别有限通用物体候选；徒步鞋靴、登山杖、帐篷、睡袋和药品没有专用类别，请结合路线装备清单手动核对。床类仅提供铺位/睡垫候选，不表示识别出睡袋。','模型不能判断衣物材质、装备性能或完整性。如已选择路线，清单按路线、出发日期和负重方式生成；天气只在可用的当日坐标预报范围内补充。'],plan:['饮用水及补给','适合路面的鞋袜','防雨及保暖层','离线轨迹及备用电源','急救用品','头灯','紧急联系方式'].map(name=>({name}))};
 }finally{busy=false;}
};
