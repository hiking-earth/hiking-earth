import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [{
      source: "/client-app/static/offline-maps/:path*",
      headers: [
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Access-Control-Allow-Methods", value: "GET, HEAD, OPTIONS" },
        { key: "Access-Control-Expose-Headers", value: "Content-Length" },
      ],
    }];
  },
};

export default nextConfig;
