import {Unzlib} from 'fflate';
import {terrariumHeight} from '@shared/terrain/terrarium';
const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
function crc(bytes:Uint8Array,start:number,end:number):number{let c=0xffffffff;for(let i=start;i<end;i++){c^=bytes[i];for(let b=0;b<8;b++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
/** Strict 256px, 8-bit RGB/RGBA, noninterlaced PNG; bounded inflate, no browser decoder. */
export function decodeTerrainPng(data:Uint8Array):Float32Array{
 if(data.length<33||data.length>1024*1024)throw new Error('高程PNG大小无效');
 const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
 if(view.getUint32(0)!==0x89504e47||view.getUint32(4)!==0x0d0a1a0a)throw new Error('高程PNG头无效');
 let offset=8,channels=0,ended=false,idatEnded=false;const chunks:Uint8Array[]=[];
 while(offset+12<=data.length){const length=view.getUint32(offset),end=offset+12+length;if(end>data.length)throw new Error('高程PNG条目不完整');const type=String.fromCharCode(...data.subarray(offset+4,offset+8));
  if(crc(data,offset+4,offset+8+length)!==view.getUint32(offset+8+length))throw new Error('高程PNG校验失败');
  if(!channels&&type!=='IHDR')throw new Error('高程PNG缺少尺寸头');
  if(type==='IHDR'){if(channels||length!==13||view.getUint32(offset+8)!==256||view.getUint32(offset+12)!==256||data[offset+16]!==8||![2,6].includes(data[offset+17])||data[offset+18]!==0||data[offset+19]!==0||data[offset+20]!==0)throw new Error('不支持的高程PNG编码');channels=data[offset+17]===2?3:4;}
  else if(type==='IDAT'){if(idatEnded)throw new Error('高程PNG数据段顺序无效');chunks.push(data.subarray(offset+8,offset+8+length));}
  else if(type==='IEND'){if(length!==0||!chunks.length||end!==data.length)throw new Error('高程PNG结尾无效');ended=true;break;}
  else{if(chunks.length)idatEnded=true;if((data[offset+4]&32)===0&&type!=='PLTE')throw new Error('不支持的PNG关键段');}
  offset=end;
 }
 if(!ended)throw new Error('高程PNG缺少结尾');const stride=256*channels,expected=(stride+1)*256,raw=new Uint8Array(expected);let received=0;
 const inflate=new Unzlib(chunk=>{if(received+chunk.length>expected)throw new Error('高程PNG解压超限');raw.set(chunk,received);received+=chunk.length;});
 for(let i=0;i<chunks.length;i++){const chunk=chunks[i];for(let j=0;j<chunk.length;j+=1024)inflate.push(chunk.subarray(j,j+1024),i===chunks.length-1&&j+1024>=chunk.length);}
 if(received!==expected)throw new Error('高程PNG像素不完整');
 const pixels=new Uint8Array(stride*256),heights=new Float32Array(256*256);
 for(let y=0;y<256;y++){const filter=raw[y*(stride+1)];if(filter>4)throw new Error('高程PNG过滤方式无效');for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;pixels[i]=(raw[y*(stride+1)+1+x]+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;}
  for(let x=0;x<256;x++){const i=y*stride+x*channels;if(channels===4&&pixels[i+3]!==255)throw new Error('高程PNG含透明无效值');heights[y*256+x]=terrariumHeight(pixels[i],pixels[i+1],pixels[i+2]);}}
 return heights;
}
export function shadeTerrain(heights:Float32Array,zoom:number,tileY:number):{pixels:Uint8ClampedArray;min:number;max:number}{
 if(heights.length!==65536||!Number.isInteger(zoom)||zoom<0||zoom>14||!Number.isInteger(tileY)||tileY<0||tileY>=2**zoom)throw new Error('地形绘图输入无效');
 const latitude=Math.atan(Math.sinh(Math.PI*(1-2*(tileY+0.5)/2**zoom))),meters=Math.max(0.01,40075016.686*Math.cos(latitude)/(256*2**zoom));
 let min=Infinity,max=-Infinity;for(const h of heights){if(!Number.isFinite(h))throw new Error('高程值无效');min=Math.min(min,h);max=Math.max(max,h);}const pixels=new Uint8ClampedArray(65536*4);
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=y*256+x,dx=(heights[y*256+Math.min(255,x+1)]-heights[y*256+Math.max(0,x-1)])/(2*meters),dy=(heights[Math.min(255,y+1)*256+x]-heights[Math.max(0,y-1)*256+x])/(2*meters),light=Math.max(0.25,(-dx*0.5-dy*0.5+0.707)/Math.sqrt(dx*dx+dy*dy+1)),t=Math.max(0,Math.min(1,(heights[i]+100)/4100));pixels[i*4]=(55+150*t)*light;pixels[i*4+1]=(125+80*t)*light;pixels[i*4+2]=(88+80*t)*light;pixels[i*4+3]=255;}
 return{pixels,min,max};
}
