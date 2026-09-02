const UPSTREAM_ORIGIN = "https://hiking-earth.hiking-earth.workers.dev";

export async function proxyToHikingEarth(request) {
  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, UPSTREAM_ORIGIN);
  const headers = new Headers(request.headers);

  // The original EdgeOne host must never be forwarded as the Cloudflare host.
  headers.delete("host");
  headers.delete("content-length");

  try {
    const response = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set("X-Hiking-Earth-Delivery", "edgeone-domestic-test-proxy");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    return new Response("徒步地球国内测试入口暂时无法连接上游服务，请稍后重试。", {
      status: 502,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
