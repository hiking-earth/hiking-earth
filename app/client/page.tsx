export const metadata = { title: '徒步地球 · 全端客户端' };
const tabs={companion:'pages/companion/companion',navigation:'pages/navigation/navigation',track:'pages/track/track',my:'pages/my/my'};
export default async function ClientPage({searchParams}:{searchParams:Promise<{tab?:string}>}) {
 const params=await searchParams||{},route=tabs[params.tab as keyof typeof tabs]||'pages/index/index';
 return <main style={{height:'100dvh',background:'#01030a',display:'flex',flexDirection:'column'}}>
  <iframe src={'/client-app/index.html#/'+route} title="徒步地球完整客户端" allow="geolocation; camera; clipboard-write" style={{flex:1,width:'100%',border:0,minHeight:0}} />
 </main>;
}
