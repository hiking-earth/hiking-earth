const test = require('node:test');
const assert = require('node:assert/strict');
const modulePath = require.resolve('../../app/cloudfunctions/client-api/weather.js');
test('forecast validates coordinates, deduplicates and caches attributed data', async () => {
  delete require.cache[modulePath];
  const original = global.fetch; let calls = 0;
  global.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({properties:{timeseries:[{time:new Date().toISOString(),data:{instant:{details:{air_temperature:20,wind_speed:2,relative_humidity:50}},next_1_hours:{details:{precipitation_amount:0}}}}]}}),{headers:{expires:new Date(Date.now()+600000).toUTCString()}});
  };
  try {
    const {forecast} = require(modulePath);
    await assert.rejects(forecast({latitude:91,longitude:0}));
    await assert.rejects(forecast({latitude:'1',longitude:0}));
    const results = await Promise.all([forecast({latitude:34.48,longitude:113.05}),forecast({latitude:34.48,longitude:113.05})]);
    assert.equal(calls,1); assert.equal(results[0].status,'available');
    assert.equal(results[0].license,'CC BY 4.0');
    assert.equal(results[0].weather.rain,'0 mm / 下一小时');
    await forecast({latitude:34.48,longitude:113.05}); assert.equal(calls,1);
  } finally {global.fetch=original; delete require.cache[modulePath];}
});
test('malformed supplier response degrades without inventing a forecast',async()=>{
  const original=global.fetch;
  global.fetch=async()=>new Response(JSON.stringify({properties:{timeseries:[]}}));
  try { const {forecast}=require(modulePath); const result=await forecast({latitude:0,longitude:0}); assert.equal(result.status,'unavailable'); assert.equal(result.weather,undefined); }
  finally {global.fetch=original;delete require.cache[modulePath];}
});
test('rejects stale or distant forecasts and impossible weather readings', async () => {
 const original=global.fetch;
 const cases=[{time:new Date(Date.now()-7200000).toISOString()}, {time:new Date(Date.now()+86400000).toISOString()}, {humidity:101},{wind:-1},{temperature:90},{rain:-2}];
 try {
  for(const item of cases){
   delete require.cache[modulePath];
   global.fetch=async()=>new Response(JSON.stringify({properties:{timeseries:[{time:item.time||new Date().toISOString(),data:{instant:{details:{air_temperature:item.temperature??20,wind_speed:item.wind??2,relative_humidity:item.humidity??50}},next_1_hours:{details:{precipitation_amount:item.rain??0}}}}]}}));
   const result=await require(modulePath).forecast({latitude:1,longitude:1});
   assert.equal(result.status,'unavailable');assert.equal(result.weather,undefined);
  }
 } finally {global.fetch=original;delete require.cache[modulePath];}
});
