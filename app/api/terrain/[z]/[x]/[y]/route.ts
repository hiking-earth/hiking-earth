import { NextResponse } from "next/server";

const TERRAIN_UPSTREAM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

export async function GET(_request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y: rawY } = await params;
  const y = rawY.replace(/\.png$/, "");
  if (![z, x, y].every((value) => /^\d+$/.test(value))) return new NextResponse("Invalid terrain tile", { status: 400 });
  try {
    const upstream = await fetch(`${TERRAIN_UPSTREAM}/${z}/${x}/${y}.png`, { cache: "force-cache" });
    if (!upstream.ok) return new NextResponse("Terrain tile unavailable", { status: 502 });
    return new NextResponse(await upstream.arrayBuffer(), {
      headers: {
        "content-type": "image/png",
        "cache-control": "public, max-age=86400, immutable",
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    return new NextResponse("Terrain tile unavailable", { status: 502 });
  }
}
