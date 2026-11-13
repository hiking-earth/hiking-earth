type Point = {x:number;y:number};
type Bounds = {left:number;top:number;scrollLeft?:number;scrollTop?:number};
/** Convert platform touch or mouse coordinates into canvas-local coordinates. */
export function globePoint(event:any,bounds:Bounds,ending=false):Point|null {
 const touch=(ending?event.changedTouches:event.touches)?.[0];
 let x:unknown,y:unknown;
 if(touch){
  if(Number.isFinite(touch.x)&&Number.isFinite(touch.y)){x=touch.x;y=touch.y;}
  else if(Number.isFinite(touch.clientX)&&Number.isFinite(touch.clientY)){x=touch.clientX-bounds.left;y=touch.clientY-bounds.top;}
  else if(Number.isFinite(touch.pageX)&&Number.isFinite(touch.pageY)){x=touch.pageX-bounds.left-(bounds.scrollLeft||0);y=touch.pageY-bounds.top-(bounds.scrollTop||0);}
 } else if(Number.isFinite(event.offsetX)&&Number.isFinite(event.offsetY)){x=event.offsetX;y=event.offsetY;}
 else if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){x=event.clientX-bounds.left;y=event.clientY-bounds.top;}
 return typeof x==='number'&&typeof y==='number'&&Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;
}

/** Pinch distance works with both viewport and page-coordinate touch APIs. */
export function globeTouchDistance(event:any):number {
 const touches=event.touches||[],a=touches[0],b=touches[1];
 if(!a||!b)return 0;
 const ax=Number.isFinite(a.clientX)?a.clientX:Number.isFinite(a.x)?a.x:a.pageX;
 const ay=Number.isFinite(a.clientY)?a.clientY:Number.isFinite(a.y)?a.y:a.pageY;
 const bx=Number.isFinite(b.clientX)?b.clientX:Number.isFinite(b.x)?b.x:b.pageX;
 const by=Number.isFinite(b.clientY)?b.clientY:Number.isFinite(b.y)?b.y:b.pageY;
 return [ax,ay,bx,by].every(Number.isFinite)?Math.hypot(ax-bx,ay-by):0;
}

/** Hit the visible pin body and prefer the marker painted last (topmost). */
export function hitGlobePin<T extends Point>(hits:readonly T[],point:Point):T|null {
 for(let index=hits.length-1;index>=0;index--){
  const hit=hits[index];
  if(Math.abs(hit.x-point.x)<=15&&point.y>=hit.y-35&&point.y<=hit.y+2)return hit;
 }
 return null;
}
