import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

test("weather proxy accepts a fresh legacy CloudBase forecast without fetchedAt", async () => {
  const source = await readFile(new URL("../app/api/weather/route.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const weatherModule = { exports: {} };
  const response = Response.json({
    ok: true,
    data: {
      status: "available",
      provider: "MET Norway",
      license: "CC BY 4.0",
      weather: {
        city: "35.68,139.69",
        temperature: "20.4 °C",
        wind: "5.9 m/s",
        humidity: "63%",
        rain: "0 mm / 下一小时",
        observedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      },
    },
  });
  const fetchStub = async () => response;
  const requireStub = specifier => {
    if (specifier === "next/server") {
      return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    }
    if (specifier === "@/data/weather-gear-advice") {
      return {
        isCurrentForecastTime: value => {
          const time = Date.parse(value);
          return Number.isFinite(time) && time >= Date.now() - 60 * 60 * 1000 && time <= Date.now() + 2 * 60 * 60 * 1000;
        },
      };
    }
    throw new Error(`Unexpected module: ${specifier}`);
  };
  new Function("require", "module", "exports", "fetch", javascript)(requireStub, weatherModule, weatherModule.exports, fetchStub);

  const result = await weatherModule.exports.GET({
    nextUrl: new URL("https://hiking-earth.invalid/api/weather?latitude=35.68&longitude=139.69"),
  });
  const payload = await result.json();

  assert.equal(result.status, 200);
  assert.equal(payload.status, "available");
  assert.equal(payload.provider, "MET Norway");
  assert.equal(payload.license, "CC BY 4.0");
  assert.ok(Number.isFinite(Date.parse(payload.weather.fetchedAt)));
  assert.match(result.headers.get("cache-control"), /^private, max-age=/);
});

test("weather proxy rejects a CloudBase response larger than its bounded read limit", async () => {
  const source = await readFile(new URL("../app/api/weather/route.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const weatherModule = { exports: {} };
  const fetchStub = async () => new Response("x".repeat(256 * 1024 + 1));
  const requireStub = specifier => {
    if (specifier === "next/server") {
      return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    }
    if (specifier === "@/data/weather-gear-advice") {
      return { isCurrentForecastTime: () => true };
    }
    throw new Error(`Unexpected module: ${specifier}`);
  };
  new Function("require", "module", "exports", "fetch", javascript)(requireStub, weatherModule, weatherModule.exports, fetchStub);

  const result = await weatherModule.exports.GET({
    nextUrl: new URL("https://hiking-earth.invalid/api/weather?latitude=36.00&longitude=140.00"),
  });
  const payload = await result.json();

  assert.equal(result.status, 503);
  assert.equal(payload.status, "unavailable");
  assert.match(source, /MAX_PROXY_RESPONSE_BYTES = 256 \* 1024/);
});

test("fresh forecast with expired provider Expires is served without caching", async () => {
  const source = await readFile(new URL("../app/api/weather/route.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const weatherModule = { exports: {} };
  let calls = 0;
  const fetchStub = async () => {
    calls++;
    return Response.json({
      ok: true,
      data: {
        status: "available",
        provider: "MET Norway",
        license: "CC BY 4.0",
        cacheExpiresAt: new Date(Date.now() - 1).toISOString(),
        weather: {
          city: "1.00,2.00",
          temperature: "20 °C",
          wind: "5 m/s",
          humidity: "50%",
          rain: "0 mm / 下一小时",
          observedAt: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
        },
      },
    });
  };
  const requireStub = specifier => {
    if (specifier === "next/server") {
      return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    }
    if (specifier === "@/data/weather-gear-advice") return { isCurrentForecastTime: () => true };
    throw new Error(`Unexpected module: ${specifier}`);
  };
  new Function("require", "module", "exports", "fetch", javascript)(requireStub, weatherModule, weatherModule.exports, fetchStub);

  const request = {
    nextUrl: new URL("https://hiking-earth.invalid/api/weather?latitude=1&longitude=2"),
  };
  const first = await weatherModule.exports.GET(request);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).status, "available");
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  await new Promise(resolve => setTimeout(resolve, 260));
  const second = await weatherModule.exports.GET(request);
  assert.equal(second.status, 200);
  assert.equal(calls, 2);
});
