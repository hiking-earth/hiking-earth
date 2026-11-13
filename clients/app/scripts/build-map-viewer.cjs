const fs=require('node:fs'),path=require('node:path'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),output=path.join(root,'native-assets/static/native-map');fs.mkdirSync(output,{recursive:true});
const main=esbuild.buildSync({entryPoints:[path.join(root,'map-viewer/main.js')],bundle:true,write:false,format:'iife',target:'es2020',minify:true}).outputFiles[0].text;
const worker=esbuild.buildSync({entryPoints:[path.join(root,'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')],bundle:true,write:false,format:'iife',target:'es2020',minify:true}).outputFiles[0].text;
const css=fs.readFileSync(path.join(root,'node_modules/maplibre-gl/dist/maplibre-gl.css'),'utf8');
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#map{margin:0;height:100%;width:100%}#status{position:absolute;top:0;left:0;right:0;background:#151d27dd;color:white;padding:8px;font:12px sans-serif;z-index:5}'+css+'</style></head><body><div id="map"></div><div id="status">正在加载在线底图…</div><script>window.hikingWorker='+JSON.stringify(worker).replace(/</g,'\\u003c')+';</script><script>'+main.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
fs.writeFileSync(path.join(output,'viewer.html'),html);fs.copyFileSync(path.join(root,'node_modules/maplibre-gl/LICENSE.txt'),path.join(output,'MapLibre-LICENSE.txt'));
console.log('Bundled local native map renderer; online tiles remain external and attributed.');
