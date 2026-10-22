import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("components/GearPhotoScan.tsx", "utf8");
const privacy = readFileSync("app/privacy/page.tsx", "utf8");

test("web free photo detection includes the same manually-confirmed outdoor furniture candidates", () => {
  const expected = [
    'bench: ["步道长椅/露营凳候选（请确认用途）", "休息"]',
    'chair: ["露营椅候选（请确认类型）", "休息"]',
    'bed: ["铺位/睡垫候选（请确认物品）", "睡眠"]',
    '"dining table": ["露营桌候选（请确认用途）", "炊具"]',
  ];
  for (const label of expected) assert.ok(source.includes(label), `web label missing: ${label}`);
  assert.ok(source.includes("床类只提供铺位/睡垫候选，不表示识别出睡袋。"));
});

test("web privacy notice distinguishes local photo detection from consented cloud processing", () => {
  assert.ok(privacy.includes("在当前设备处理，不上传照片"));
  assert.ok(privacy.includes("开启“装备照片云端分析”且服务可用时上传所选照片"));
  assert.ok(privacy.includes("自托管的免费 CPU 模型"));
  assert.ok(privacy.includes("照片与本次使用的路线名称可能交由该服务处理"));
  assert.ok(privacy.includes("路线名称也会用于本次装备建议"));
});

test("web local photo detection constructs a browser image without shadowing next/image", () => {
  assert.ok(source.includes('import NextImage from "next/image";'));
  assert.ok(source.includes("const image = new window.Image();"));
  assert.ok(source.includes("<NextImage className=\"gear-photo-preview\""));
  assert.ok(!source.includes("new Image()"));
});
