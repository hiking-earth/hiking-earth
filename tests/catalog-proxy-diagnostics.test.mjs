import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const routeUrl = new URL("../app/api/catalog/route.ts", import.meta.url);

async function loadRoute() {
  const source = await readFile(routeUrl, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const require = (specifier) => {
    if (specifier === "next/server") return { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), init) } };
    if (specifier === "../../../data/catalog-limits") return { CATALOG_PAGE_SIZE: 400, CATALOG_SOURCE_LIMIT: 250000 };
    throw new Error(`Unexpected route dependency: ${specifier}`);
  };
  new Function("require", "exports", compiled)(require, exports);
  return exports;
}

test("catalog proxy logs upstream status without copying response body", async () => {
  const route = await loadRoute();
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs = [];
  globalThis.fetch = async () => new Response(JSON.stringify({ errMsg: "upstream-private-detail" }), { status: 400 });
  console.warn = (value) => logs.push(String(value));
  try {
    const response = await route.GET(new Request("https://site.test/api/catalog?source=hk&page=0"));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "catalog_unavailable" });
    assert.equal(logs.length, 1);
    const diagnostic = JSON.parse(logs[0]);
    assert.deepEqual(diagnostic, {
      event: "catalog_proxy_failure",
      source: "hk",
      page: 0,
      stage: "upstream_status",
      upstreamStatus: 400,
    });
    assert.doesNotMatch(logs[0], /upstream-private-detail|errMsg|url|authorization|token/i);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("catalog proxy records only allowlisted transport errors", async () => {
  const route = await loadRoute();
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs = [];
  const failure = new Error("private endpoint detail");
  failure.code = "ECONNRESET";
  globalThis.fetch = async () => { throw failure; };
  console.warn = (value) => logs.push(String(value));
  try {
    const response = await route.GET(new Request("https://site.test/api/catalog?source=hk&page=2"));
    assert.equal(response.status, 503);
    const diagnostic = JSON.parse(logs[0]);
    assert.deepEqual(diagnostic, {
      event: "catalog_proxy_failure",
      source: "hk",
      page: 2,
      stage: "upstream_fetch",
      errorCode: "ECONNRESET",
    });
    assert.doesNotMatch(logs[0], /private endpoint detail|ECONNRESET.*message|stack/i);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
