import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const images = JSON.parse(await readFile(new URL("../data/scenic-images.json", import.meta.url), "utf8"));
const component = await readFile(new URL("../components/RegionPhoto.tsx", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const privacy = await readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");

test("region photos keep attribution, explicit license, and consent-first loading", () => {
  const photo = images.items.find((item) => item.id === "grand-canyon-pima-2010");
  assert.ok(photo);
  assert.ok(photo.matchRegions.includes("美国·Grand Canyon National Park"));
  assert.equal(new URL(photo.imageUrl).hostname, "upload.wikimedia.org");
  assert.equal(new URL(photo.sourceUrl).hostname, "commons.wikimedia.org");
  assert.equal(photo.license, "CC BY-SA 4.0");
  assert.equal(new URL(photo.licenseUrl).hostname, "creativecommons.org");
  assert.match(photo.title, /非路线现况/);
  assert.match(component, /setShown\(true\)/);
  assert.match(component, /safeCommonsUrl\(photo\.imageUrl, \["upload\.wikimedia\.org"\]\)/);
  assert.match(component, /photo\.author/);
  assert.match(component, /photo\.license/);
  assert.match(page, /<RegionPhoto region=\{activeRoute\.region\} \/>/);
  assert.match(privacy, /Wikimedia Commons/);
});
