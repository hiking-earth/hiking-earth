// Native image pickers hide the page while their asynchronous result is pending.
export function createPhotoSelection(currentToken:()=>string|undefined,apply:(path:string)=>void){
 let visible=true,disposed=false,epoch=0;
 let pending:{epoch:number;token:string|undefined;path:string}|null=null;
 const flush=()=>{
  if(!visible||!pending||disposed)return;
  const value=pending;pending=null;
  if(value.epoch===epoch&&value.token===currentToken())apply(value.path);
 };
 return {
  begin(){pending=null;return {epoch:++epoch,token:currentToken()};},
  complete(ticket:{epoch:number;token:string|undefined},path:string){
   if(disposed||ticket.epoch!==epoch||ticket.token!==currentToken()||!path)return;
   pending={...ticket,path};flush();
  },
  show(){visible=true;flush();},
  hide(){visible=false;},
  reset(){epoch++;pending=null;},
  dispose(){disposed=true;epoch++;pending=null;},
 };
}
