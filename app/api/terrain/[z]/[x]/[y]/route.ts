import { NextResponse } from "next/server";

const TERRAIN_UPSTREAM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

export async function GET(_request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y: rawY } = await params;
  const y = rawY.replace(/\.png$/, "");
  if (![z, x, y].every((value) => /^\d+$/.test(value))) return new NextResponse("Invalid terrain tile", { status: 400 });
  const zoom=Number(z),column=Number(x),row=Number(y);
  if(!Number.isSafeInteger(zoom)||zoom<0||zoom>14||!Number.isSafeInteger(column)||column<0||column>=2**zoom||!Number.isSafeInteger(row)||row<0||row>=2**zoom)return new NextResponse("Terrain tile outside supported range",{status:400});
  try {
    const upstream = await fetch(`${TERRAIN_UPSTREAM}/${z}/${x}/${y}.png`, { cache: "force-cache", signal:AbortSignal.timeout(12000) });
    if (!upstream.ok) return new NextResponse("Terrain tile unavailable", { status: 502 });
    const chunks:Uint8Array[]=[];let length=0;
    if(!upstream.body)return new NextResponse("Terrain tile unavailable",{status:502});
    const reader=upstream.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1024*1024){await reader.cancel();throw new Error("Terrain tile exceeds budget");}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
    if(length<8||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))throw new Error("Invalid terrain PNG");
    return new NextResponse(bytes, {
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
