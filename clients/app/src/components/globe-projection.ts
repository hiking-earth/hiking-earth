export function projectGlobe(lon:number,lat:number,centerLon:number,centerLat:number){
 const r=Math.PI/180,a=lat*r,b=centerLat*r,d=(lon-centerLon)*r;
 return {x:Math.cos(a)*Math.sin(d),y:Math.sin(a)*Math.cos(b)-Math.cos(a)*Math.cos(d)*Math.sin(b),z:Math.sin(a)*Math.sin(b)+Math.cos(a)*Math.cos(d)*Math.cos(b)};
}
export function* prioritizeSelectedGlobeRoute<T extends {id:string}>(routes:readonly T[],selectedId?:string):IterableIterator<T>{
 const selectedIndex=selectedId?routes.findIndex(route=>route.id===selectedId):-1;
 if(selectedIndex>=0)yield routes[selectedIndex];
 for(let index=0;index<routes.length;index++)if(index!==selectedIndex)yield routes[index];
}
export function rotateGlobe(lon:number,lat:number,dx:number,dy:number,scale:number){return {lon:((lon-dx/scale*70+540)%360)-180,lat:Math.max(-80,Math.min(80,lat+dy/scale*70))};}
