import { mkdir, writeFile } from "node:fs/promises";

const outputDirectory = new URL("./static/", import.meta.url);

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  new URL("edgeone-proxy-build.txt", outputDirectory),
  "徒步地球 EdgeOne 国内测试入口。全部网页和接口由 Edge Function 转发到当前 Cloudflare 测试站。\n",
  "utf8",
);
