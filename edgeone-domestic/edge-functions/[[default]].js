import { proxyToHikingEarth } from "./_proxy.js";

export async function onRequest(context) {
  return proxyToHikingEarth(context.request);
}
