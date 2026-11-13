import { accountRequest } from './account';
import { isCurrentForecastTime } from '@shared/weather-gear-advice';
export type RouteForecast = {status:'available'|'unavailable';message?:string;providerNotice?:string;sourceUrl:string;provider?:string;license?:string;cacheExpiresAt?:string;weather?:{city:string;temperature:string;wind:string;humidity:string;rain:string;observedAt:string;fetchedAt:string}};
const CACHE_KEY='he_route_weather_v1',MAX_ENTRIES=32,TTL=10*60*1000;
const inFlight=new Map<string,Promise<RouteForecast>>();
function valid(value:RouteForecast,expectedCell:string,allowExpiredProviderCache=false):boolean{
 const weather=value?.weather;
 const fetchedAt=typeof weather?.fetchedAt==='string'?Date.parse(weather.fetchedAt):Number.NaN;
 const cacheExpiry=value.cacheExpiresAt===undefined?Number.POSITIVE_INFINITY:Date.parse(value.cacheExpiresAt);
 return value?.status==='available'&&!!weather&&weather.city===expectedCell&&[weather.temperature,weather.wind,weather.humidity,weather.rain].every(v=>typeof v==='string'&&v.length<100)&&isCurrentForecastTime(weather.observedAt)&&Number.isFinite(fetchedAt)&&fetchedAt<=Date.now()+5*60*1000&&(allowExpiredProviderCache||cacheExpiry>Date.now())&&value.provider==='MET Norway'&&value.license==='CC BY 4.0'&&value.sourceUrl==='https://api.met.no/doc/TermsOfService'&&(value.providerNotice===undefined||(typeof value.providerNotice==='string'&&value.providerNotice.length<=200));
}
export async function routeForecast(center:[number,number],force=false):Promise<RouteForecast>{
 const unavailable={status:'unavailable' as const,message:'天气预报暂不可用，请查属地预警。',sourceUrl:'https://api.met.no/doc/TermsOfService'};
 if(!Array.isArray(center)||center.length!==2||!center.every(Number.isFinite)||Math.abs(center[0])>180||Math.abs(center[1])>90)return unavailable;
 // Weather needs an area forecast, not a precise point. Match the web proxy's
 // ~1 km coordinate granularity before both local caching and network egress.
 const longitude=Number(center[0].toFixed(2)),latitude=Number(center[1].toFixed(2));
 const key=`${latitude.toFixed(2)},${longitude.toFixed(2)}`;let rows:any[]=[];
 try{const stored=uni.getStorageSync(CACHE_KEY);if(Array.isArray(stored)&&stored.length<=MAX_ENTRIES)rows=stored.filter(row=>row&&typeof row.key==='string'&&Number.isFinite(row.savedAt)&&row.savedAt<=Date.now()&&Date.now()<(Number.isFinite(row.expiresAt)?row.expiresAt:row.savedAt+TTL)&&row.savedAt+TTL>Date.now()&&valid(row.value,row.key));}catch{}
 const cached=rows.find(row=>row.key===key);if(cached&&!force)return cached.value;
 const pending=inFlight.get(key);if(pending)return pending;
 const request=(async()=>{
  const response=await accountRequest<RouteForecast>('weather.forecast',{latitude,longitude});
  if(!response.ok||!response.data||!valid(response.data,key,true))return unavailable;
  try{const savedAt=Date.now(),providerExpiry=Date.parse(response.data.cacheExpiresAt||''),expiresAt=Math.min(savedAt+TTL,Number.isFinite(providerExpiry)?providerExpiry:savedAt+TTL);if(expiresAt>savedAt)uni.setStorageSync(CACHE_KEY,[{key,savedAt,expiresAt,value:response.data},...rows.filter(row=>row.key!==key)].slice(0,MAX_ENTRIES));}catch{}
  return response.data;
 })();
 inFlight.set(key,request);
 try{return await request;}finally{if(inFlight.get(key)===request)inFlight.delete(key);}
}
