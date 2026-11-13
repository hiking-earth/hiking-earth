import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const api='https://cloud1-d9g4fl3fu2491914f-1499973049.ap-shanghai.app.tcloudbase.com/client-api';
const checks=[];
for(const [region,latitude,longitude] of [['China',34.49,113.06],['Europe',59.91,10.75],['North America',40.71,-74.01],['Oceania',-33.87,151.21]]){
 const response=await fetch(api,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'weather.forecast',data:{latitude,longitude}}),signal:AbortSignal.timeout(25000)});
 const result=await response.json();assert.equal(response.status,200);assert.equal(result.ok,true);assert.equal(result.data.status,'available');assert.equal(result.data.provider,'MET Norway');assert.equal(result.data.license,'CC BY 4.0');assert.ok(Number.isFinite(Date.parse(result.data.weather.observedAt)));
 checks.push({region,latitude,longitude,status:'passed',forecast:result.data.weather});
}
const report={checkedAt:new Date().toISOString(),scope:'Four public route-region forecasts. Not every region or native-device acceptance.',checks};
await writeFile(new URL('../../docs/release/deployed-weather-acceptance-2026-10-07.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
