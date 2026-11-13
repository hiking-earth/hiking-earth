type Point={longitude:number;latitude:number;segmentStart?:boolean};
let pending:{points:Point[];position:Point|null;createdAt:number}|null=null;
export function prepareMapViewer(points:Point[],position?:Point|null):void {pending={points:points.slice(0,20000).map(p=>({...p})),position:position?{...position}:null,createdAt:Date.now()};}
export function takeMapViewer(){const result=pending;pending=null;return result&&Date.now()-result.createdAt<60000?result:null;}
