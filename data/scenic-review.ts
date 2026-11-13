/** A review freshness window, not a claim that every image right is cleared. */
export function scenicReviewCurrent(item:{checkedAt?:unknown;expiresAt?:unknown;reviewStatus?:unknown},now=Date.now()):boolean {
 if(!Number.isFinite(now)||typeof item.checkedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(item.checkedAt))return false;
 const checked=Date.parse(item.checkedAt+'T00:00:00Z');
 if(!Number.isFinite(checked)||new Date(checked).toISOString().slice(0,10)!==item.checkedAt||checked>now)return false;
 if(item.reviewStatus!==undefined&&item.reviewStatus!=='approved')return false;
 const ceiling=checked+90*86400000;
 // Legacy curated entries retain their existing review date with the same ceiling.
 if(item.expiresAt===undefined)return now<ceiling;
 if(typeof item.expiresAt!=='string')return false;
 const expires=Date.parse(item.expiresAt);
 return Number.isFinite(expires)&&expires>checked&&expires<=ceiling&&now<expires;
}
