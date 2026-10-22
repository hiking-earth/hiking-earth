import { AuthenticatedClientShell } from "@/components/AuthenticatedClientShell";

export const metadata = { title: '徒步地球 · 全端客户端' };
const tabs={companion:'pages/companion/companion',navigation:'pages/navigation/navigation',track:'pages/track/track',my:'pages/my/my'};
export default async function ClientPage({searchParams}:{searchParams:Promise<{tab?:string}>}) {
 const params=await searchParams||{},route=tabs[params.tab as keyof typeof tabs]||'pages/index/index';
 return <AuthenticatedClientShell route={route} />;
}
