import type { Metadata } from "next";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const notoSans = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
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
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={notoSans.variable}>{children}</body></html>;
}
