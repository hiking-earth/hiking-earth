/** A browser's explicit offline signal is definitive; unknown state is not. */
export function browserReportsOffline():boolean{
 try{return typeof navigator!=='undefined'&&navigator.onLine===false;}catch{return false;}
}
