import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";

const staticRoot = new URL("../static/", import.meta.url);
const vinext = await import("../runtime/server/index.js");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
]);

function assetPath(pathname) {
  const cleanPath = pathname.replace(/^\/+/, "") || "index.html";
  const resolved = normalize(join(staticRoot.pathname, cleanPath));
  if (resolved !== staticRoot.pathname && !resolved.startsWith(`${staticRoot.pathname}${sep}`)) return null;
  return resolved;
}

async function assetsFetch(request) {
  const url = new URL(request.url);
  const filePath = assetPath(url.pathname);
  if (!filePath) return new Response("Not found", { status: 404 });

  try {
    const body = await readFile(filePath);
    const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    return new Response(body, {
      headers: {
        "Content-Type": contentTypes.get(extension) ?? "application/octet-stream",
        "Cache-Control": url.pathname.includes("/_next/") ? "public, max-age=31536000, immutable" : "no-cache",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const imageFallback = {
  input(stream) {
    return {
      transform() {
        return {
          output: async () => ({ response: () => new Response(stream, { headers: { "Content-Type": "image/png" } }) }),
        };
      },
    };
  },
};

const env = {
  ASSETS: { fetch: assetsFetch },
  IMAGES: imageFallback,
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

export async function onRequest(requestContext) {
  return vinext.default.fetch(requestContext.request, env, context);
}
