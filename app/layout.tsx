import type { Metadata, Viewport } from "next";
import "./globals.css";

const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
const metadataBase = new URL(configuredSiteUrl || "http://localhost:8080");
const releaseReady = process.env.NEXT_PUBLIC_RELEASE_READY === "true";

export const metadata: Metadata = {
  metadataBase,
  title: "徒步地球全球徒步路线",
  description: "在 3D 地球上查开放、看四季、找路线、约同行。",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "徒步地球全球徒步路线",
    description: "查开放、看四季、找路线、约同行",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "徒步地球 3D 地球与路线锚点" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "徒步地球全球徒步路线",
    description: "查开放、看四季、找路线、约同行",
    images: ["/og.png"],
  },
  robots: {
    index: releaseReady,
    follow: releaseReady,
    nocache: !releaseReady,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#030712",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://server.arcgisonline.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://tiles.openfreemap.org" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="anonymous" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
