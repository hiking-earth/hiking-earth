export async function GET() {
  return Response.json({
    status: "ok",
    service: "hiking-earth-web",
    releaseReady: process.env.NEXT_PUBLIC_RELEASE_READY === "true",
    checkedAt: new Date().toISOString(),
  }, {
    headers: {
      "cache-control": "no-store",
    },
  });
}
