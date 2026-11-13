type Files = { read:(name:string)=>Promise<string>; write:(name:string,text:string)=>Promise<void> };
const MAX_BYTES=24*1024*1024,CHUNK_CHARS=512*1024,MAX_PARTS=64;
const bytes=(text:string)=>encodeURIComponent(text).replace(/%[A-F\d]{2}|./g,'x').length;
const partName=(name:string,index:number)=>`${name}.part-${index}`;
/** Commit the small manifest last; callers commit the selected slot afterwards. */
export async function writeChunkedCatalog(files:Files,name:string,text:string):Promise<void>{
 const size=bytes(text);if(size>MAX_BYTES)throw new Error('本机目录超过24 MB保存上限');
 let start=0,parts=0;
 while(start<text.length){
  let end=Math.min(text.length,start+CHUNK_CHARS);
  const last=text.charCodeAt(end-1);
  if(end<text.length&&last>=0xd800&&last<=0xdbff)end--;
  if(parts>=MAX_PARTS)throw new Error('目录分片数量超限');
  await files.write(partName(name,parts++),text.slice(start,end));start=end;
 }
 await files.write(`${name}.parts.json`,JSON.stringify({format:'he-catalog-parts-v1',parts,characters:text.length,bytes:size}));
}
export async function readChunkedCatalog(files:Files,name:string):Promise<string>{
 let raw:string;
 try{raw=await files.read(`${name}.parts.json`);}catch{return files.read(name);}
 // An existing invalid manifest must fail, not silently prefer an older file.
 const meta=JSON.parse(raw);
 if(meta?.format!=='he-catalog-parts-v1'||!Number.isInteger(meta.parts)||meta.parts<0||meta.parts>MAX_PARTS||!Number.isInteger(meta.characters)||meta.characters<0||meta.characters>MAX_BYTES||!Number.isInteger(meta.bytes)||meta.bytes<0||meta.bytes>MAX_BYTES)throw new Error('目录分片清单无效');
 const parts:string[]=[];let characters=0;
 for(let index=0;index<meta.parts;index++){
  const part=await files.read(partName(name,index));
  if(part.length>CHUNK_CHARS||characters+part.length>meta.characters)throw new Error('目录分片大小无效');
  parts.push(part);characters+=part.length;
 }
 const text=parts.join('');
 if(characters!==meta.characters||bytes(text)!==meta.bytes)throw new Error('目录分片不完整');
 return text;
}
