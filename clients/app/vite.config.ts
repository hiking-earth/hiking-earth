import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import path from "node:path";
import {copyVerifiedGearModel} from "../scripts/copy-verified-gear-model.mjs";
import {cpSync,mkdirSync,rmSync} from "node:fs";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [{
    name: 'hiking-maplibre-native-controls',
    enforce: 'pre',
    transform(source, id) {
      if (!id.split('?')[0].replace(/\\/g, '/').endsWith('/maplibre-gl/dist/maplibre-gl.css')) return;
      // MapLibre creates native DOM controls. uni's element-selector rewrite
      // changes button/a into uni-button/uni-a, which cannot match those nodes.
      return source
        .replace(/(\.maplibregl-ctrl(?:-group)? )button\b/g, '$1[type="button"]')
        .replace(/(\+ )button\b/g, '$1[type="button"]')
        .replace(/(\.maplibregl-ctrl-attrib )a\b/g, '$1[href]');
    },
  }, uni(), {
    name: 'hiking-app-inline-dynamic-imports',
    enforce: 'post',
    apply: 'build',
    configResolved(config) {
      // The native App compiler emits an IIFE AppService bundle. Dynamic
      // imports from model dependencies otherwise create Rollup chunks that
      // cannot be represented by that output format.
      if (process.env.UNI_PLATFORM !== 'app') return;
      const outputs = Array.isArray(config.build.rollupOptions.output)
        ? config.build.rollupOptions.output
        : [config.build.rollupOptions.output];
      for (const output of outputs) {
        if (!output) continue;
        output.inlineDynamicImports = true;
        delete output.manualChunks;
      }
    },
  }, {
    name: 'hiking-h5-map-assets',
    apply: 'build',
    closeBundle() {
      const platform = process.env.UNI_PLATFORM;
      if (!['h5','app','app-plus','mp-weixin'].includes(platform || '')) return;
      const output = path.resolve(process.env.UNI_OUTPUT_DIR || `dist/build/${platform}`);
      const relative = path.relative(path.resolve(__dirname, 'dist'), output);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unexpected client build output');
      const isNative = platform === 'app' || platform === 'app-plus';
      if (!isNative) rmSync(path.join(output, 'static', 'native-map'), {recursive: true, force: true});
      // H5, desktop, and App-Plus run COCO-SSD locally. Keep the pinned,
      // hash-checked weights in each app's resource tree; Mini Program uses
      // explicit-consent cloud analysis to avoid bundling the model there.
      if (platform === 'h5') copyVerifiedGearModel(path.resolve(__dirname, '../shared/models/gear'), output);
      if (isNative) copyVerifiedGearModel(path.resolve(__dirname, '../shared/models/gear'), path.join(output, 'static'));
      // Desktop obtains the verified catalog and map packages from the public
      // distribution endpoint, then stores selected maps in its local map
      // store. Keep the 40+ MiB regional pack set out of every desktop installer.
      if (platform === 'h5' && process.env.VITE_DESKTOP === 'true') {
        rmSync(path.join(output, 'static', 'offline-maps'), {recursive: true, force: true});
        return;
      }
      if (platform !== 'h5' && platform !== 'app' && platform !== 'app-plus') return;
      const directory = isNative ? 'native-map' : 'offline-maps';
      const target = path.join(output, 'static', directory);
      mkdirSync(target, {recursive: true});
      cpSync(path.resolve(__dirname, isNative ? 'native-assets/static/native-map' : 'map-assets/static/offline-maps'), target, {recursive: true});
    },
  }],
  base: process.env.VITE_DESKTOP === "true" ? "./" : (process.env.VITE_PUBLIC_BASE || "/"),
  resolve: {
    alias: {
      // Monorepo 共享层：shared/（类型 / 导航算法 / 常量 / 种子数据）
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    fs: { allow: [path.resolve(__dirname, "..")] },
  },
});
