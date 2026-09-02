import { proxyToHikingEarth } from "./proxy.js";

export async function onRequest(context) {
  return proxyToHikingEarth(context.request);
}
