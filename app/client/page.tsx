export const metadata = { title: '徒步地球 · 全端客户端' };
const tabs={companion:'pages/companion/companion',navigation:'pages/navigation/navigation',track:'pages/track/track',my:'pages/my/my'};
export default async function ClientPage({searchParams}:{searchParams:Promise<{tab?:string}>}) {
 const params=await searchParams||{},route=tabs[params.tab as keyof typeof tabs]||'pages/index/index';
 return <main style={{height:'100dvh',background:'#01030a',display:'flex',flexDirection:'column'}}>
  <nav aria-label="徒步地球主导航" style={{display:'flex',gap:20,alignItems:'center',justifyContent:'center',flexWrap:'wrap',padding:'12px 16px',color:'#f4f8f2',fontSize:14}}>
   <a href="/" style={{color:'#b8f36b'}}>地球发现</a>{Object.entries(tabs).map(([key,path],index)=><a key={key} href={'/client?tab='+key} style={{color:route===path?'#b8f36b':'#a7b5aa'}}>{['约伴','导航','轨迹','我的'][index]}</a>)}
  </nav>
  <iframe src={'/client-app/index.html#/'+route} title="徒步地球完整客户端" allow="geolocation; camera; clipboard-write" style={{flex:1,width:'100%',border:0,minHeight:0}} />
 </main>;
}
