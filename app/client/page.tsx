export const metadata = { title: '账号、轨迹与组队 · 徒步地球' };
export default function ClientPage() {
  return <main style={{ height: '100dvh', background: '#0f141b', display: 'flex', flexDirection: 'column' }}>
    <nav aria-label="客户端导航" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', color: '#eef4ea' }}>
      <a href="/" style={{ color: '#b8f36b' }}>← 3D 地球与路线发现</a><span>账号 · 轨迹 · 组队 · 社区</span>
    </nav>
    <iframe src="/client-app/index.html" title="徒步地球完整客户端" allow="geolocation; camera; clipboard-write" style={{ flex: 1, width: '100%', border: 0, minHeight: 0 }} />
  </main>;
}
