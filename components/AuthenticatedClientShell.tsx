"use client";

import { useEffect, useRef, useState } from "react";
import { readClientAuthMessage } from "@/data/client-auth-message";

/** Keep direct /client visits behind the same Hiking Earth account gate as /. */
export function AuthenticatedClientShell({ route }: { route: string }) {
  const [authenticated, setAuthenticated] = useState(false);
  const loginFrame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const authenticated = readClientAuthMessage(event, loginFrame.current);
      if (authenticated !== null) setAuthenticated(authenticated);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!authenticated) {
    return (
      <main className="hiking-earth-auth-gate" style={{ minHeight: "100dvh", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(320px,460px)", background: "var(--he-color-background)", color: "var(--he-color-text)" }}>
        <section style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "clamp(28px,7vw,100px)", background: "radial-gradient(circle at 70% 45%, var(--he-color-map-wood) 0, var(--he-color-panel) 38%, var(--he-color-background) 76%)" }}>
          <span style={{ color: "var(--he-color-accent)", letterSpacing: ".18em", fontSize: 13 }}>HIKING EARTH</span>
          <h1 style={{ maxWidth: 680, margin: "22px 0 12px", fontSize: "clamp(36px,6vw,76px)", lineHeight: 1.08 }}>先登录，再出发</h1>
          <p style={{ maxWidth: 600, color: "var(--he-color-muted)", fontSize: 18, lineHeight: 1.8 }}>登录徒步地球统一账号后，才能进入完整网页客户端并使用路线、轨迹与社区功能。</p>
        </section>
        <section style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", padding: 20, boxSizing: "border-box", background: "var(--he-color-panel)", borderLeft: "1px solid var(--he-color-border)" }}>
          <div style={{ margin: "8px 8px 12px", fontWeight: 700 }}>徒步地球账号登录</div>
          <iframe ref={loginFrame} title="徒步地球账号登录" src="/client-app/index.html#/pages/account/account?loginRequired=1" allow="camera" style={{ flex: 1, width: "100%", minHeight: 560, border: 0, borderRadius: 16, background: "var(--he-color-background)" }} />
          <small style={{ margin: "12px 8px", color: "var(--he-color-muted)", lineHeight: 1.6 }}>登录后将回到本客户端入口。请勿通过聊天或邮件发送密码、恢复码或二维码。</small>
        </section>
        <style>{`@media(max-width:760px){.hiking-earth-auth-gate{grid-template-columns:1fr!important}.hiking-earth-auth-gate>section:first-child{min-height:240px;padding:28px}.hiking-earth-auth-gate>section:last-of-type{min-height:calc(100dvh - 240px);border-left:0;border-top:1px solid var(--he-color-border)}.hiking-earth-auth-gate iframe{min-height:600px!important}}`}</style>
      </main>
    );
  }

  return <main style={{ height: "100dvh", background: "var(--he-color-background)", display: "flex", flexDirection: "column" }}>
    <iframe src={`/client-app/index.html#/${route}`} title="徒步地球完整客户端" allow="geolocation; camera" style={{ flex: 1, width: "100%", border: 0, minHeight: 0 }} />
  </main>;
}
