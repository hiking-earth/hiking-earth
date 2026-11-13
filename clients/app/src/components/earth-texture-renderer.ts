import texture from './earth-texture.json';

const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decode(s:string){if(typeof uni!=='undefined'&&typeof uni.base64ToArrayBuffer==='function')return new Uint8Array(uni.base64ToArrayBuffer(s));const out=new Uint8Array(Math.floor(s.length*3/4));let bits=0,value=0,n=0;for(const c of s){const k=alphabet.indexOf(c);if(k<0)continue;value=(value<<6)|k;bits+=6;if(bits>=8){bits-=8;out[n++]=(value>>bits)&255;}}return out.subarray(0,n);}
const pixels=decode(texture.indices),palette=texture.palette;
// UI emphasis stays in the shared lime palette; atmospheric scattering keeps
// the blue-white hue of Earth's atmosphere instead of tinting the planet green.
const atmosphereColor=[92,160,230];
/** Inverse orthographic sphere sampling, using NASA's geographic satellite composite. */
export function renderEarth(size:number,longitude:number,latitude:number){
 const data=new Uint8ClampedArray(size*size*4),half=size/2,rad=Math.PI/180,phi=latitude*rad,sp=Math.sin(phi),cp=Math.cos(phi);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const nx=(x+.5-half)/half,ny=(half-y-.5)/half,d=nx*nx+ny*ny;
  if(d>1){
   const fade=1-(Math.sqrt(d)-1)/.045;
   if(fade>0){const offset=(y*size+x)*4,strength=fade*fade;data[offset]=atmosphereColor[0];data[offset+1]=atmosphereColor[1];data[offset+2]=atmosphereColor[2];data[offset+3]=Math.round(strength*34);}
   continue;
  }
  const nz=Math.sqrt(1-d),lat=Math.asin(Math.max(-1,Math.min(1,ny*cp+nz*sp))),lon=longitude*rad+Math.atan2(nx,nz*cp-ny*sp);
  const u=((lon/(2*Math.PI)+.5)%1+1)%1,v=.5-lat/Math.PI;
  // Blue Marble is equirectangular: interpolate neighboring texels and wrap
  // longitude so the texture seam stays continuous while the globe rotates.
  const rawX0=Math.floor(u*texture.width-.5),fx=u*texture.width-.5-rawX0;
  const x0=((rawX0%texture.width)+texture.width)%texture.width,x1=(x0+1)%texture.width;
  const sampleY=Math.max(0,Math.min(texture.height-1,v*texture.height-.5)),y0=Math.floor(sampleY),y1=Math.min(texture.height-1,y0+1),fy=sampleY-y0;
  const p00=pixels[y0*texture.width+x0]*3,p01=pixels[y0*texture.width+x1]*3,p10=pixels[y1*texture.width+x0]*3,p11=pixels[y1*texture.width+x1]*3;
  const texR0=palette[p00]+(palette[p01]-palette[p00])*fx,texR1=palette[p10]+(palette[p11]-palette[p10])*fx,texR=texR0+(texR1-texR0)*fy;
  const texG0=palette[p00+1]+(palette[p01+1]-palette[p00+1])*fx,texG1=palette[p10+1]+(palette[p11+1]-palette[p10+1])*fx,texG=texG0+(texG1-texG0)*fy;
  const texB0=palette[p00+2]+(palette[p01+2]-palette[p00+2])*fx,texB1=palette[p10+2]+(palette[p11+2]-palette[p10+2])*fx,texB=texB0+(texB1-texB0)*fy;
  // Keep the same Blue Marble surface colors as the web overview. Only add
  // restrained sphere shading, rather than recoloring oceans or darkening the
  // texture enough to make the client globe look like a different map theme.
  const diffuse=Math.max(0,-nx*.35+ny*.25+nz*.90),light=.90+.10*diffuse,atmosphere=Math.pow(1-nz,4)*.42,o=(y*size+x)*4;
  data[o]=texR*light*(1-atmosphere)+atmosphereColor[0]*atmosphere;
  data[o+1]=texG*light*(1-atmosphere)+atmosphereColor[1]*atmosphere;
  data[o+2]=texB*light*(1-atmosphere)+atmosphereColor[2]*atmosphere;
  data[o+3]=Math.min(255,Math.max(0,(1-Math.sqrt(d))*half*255));
 }
 return data;
}
