import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const releaseReady = process.env.NEXT_PUBLIC_RELEASE_READY === "true";
  return releaseReady
    ? { rules: { userAgent: "*", allow: "/" } }
    : { rules: { userAgent: "*", disallow: "/" } };
}
