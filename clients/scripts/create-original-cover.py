#!/usr/bin/env python3
"""Generate original geometric mountain artwork, not a route photograph."""
import math,pathlib,struct,zlib
root=pathlib.Path(__file__).resolve().parents[1];w,h=960,480
rows=[]
for y in range(h):
 row=bytearray([0])
 for x in range(w):
  t=y/h;color=(int(24+18*t),int(43+18*t),int(60+25*t))
  # Original silhouettes defined by simple trigonometric curves.
  if y>260+55*math.sin(x/115)+28*math.cos(x/63):color=(47,79,88)
  if y>325+50*math.sin(x/150+1)+25*math.cos(x/72):color=(40,66,66)
  if y>390+24*math.sin(x/170):color=(24,46,40)
  if (x-780)**2+(y-96)**2<32**2:color=(184,243,107)
  row.extend(color)
 rows.append(row)
def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),9))+chunk(b'IEND',b'')
for folder in [root/'app/src/static',root/'web/public/static']:
 folder.mkdir(parents=True,exist_ok=True);(folder/'original-mountain-reference.png').write_bytes(png)
print('Original reference illustration generated; no third-party image source.')
