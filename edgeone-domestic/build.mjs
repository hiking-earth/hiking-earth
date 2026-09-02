import { cp, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const projectRoot = new URL("../", import.meta.url);
const outputDirectory = new URL("./static/", import.meta.url);
const runtimeDirectory = new URL("./runtime/", import.meta.url);

// Build the real Vinext Worker bundle from the parent project, then package its
// server and browser assets inside this EdgeOne-only project directory.
execFileSync("npm", ["--prefix", "..", "install"], { stdio: "inherit" });
execFileSync("npm", ["--prefix", "..", "run", "build"], { stdio: "inherit" });
await mkdir(outputDirectory, { recursive: true });
await cp(new URL("dist/client/", projectRoot), outputDirectory, { recursive: true });
await cp(new URL("dist/server/", projectRoot), new URL("server/", runtimeDirectory), { recursive: true });
