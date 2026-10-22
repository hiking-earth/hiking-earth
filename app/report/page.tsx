import { DocumentShell } from "@/components/DocumentShell";

export default function ReportPage() {
  return (
    <DocumentShell eyebrow="REPORT & HELP" title="举报与帮助" updatedAt="2026-10-18">
      <h2>举报社区内容</h2>
      <p>在约伴社区打开相关帖子，长按帖子并选择举报原因。提交后应用会提示“举报已提交，等待处理”；如果该内容已有举报记录，会提示原处理记录已保留。网页不提供持续进度查询，请通过应用内入口提交，让举报与对应内容关联。</p>
      <p><a href="/client?tab=companion">打开约伴社区</a></p>

      <h2>隐私、数据或网站问题</h2>
      <p>如需咨询隐私、数据处理或举报网页问题，可联系项目个人运营者：<a href="mailto:2308582955@qq.com?subject=%E5%BE%92%E6%AD%A5%E5%9C%B0%E7%90%83%20%E9%97%AE%E9%A2%98%E5%8F%8D%E9%A6%88">2308582955@qq.com</a>。邮件中请说明问题类型、相关记录编号和必要的事实描述，便于定位处理。</p>
      <p>请勿通过邮件发送密码、验证码、密钥、他人的个人信息或完整轨迹。此邮箱不承诺固定响应时限；如需依法提出请求，请在邮件中清楚说明请求内容。</p>

      <h2>紧急情况</h2>
      <p className="document-warning">徒步地球不是救援或报警服务。遇到人身危险，请立即联系当地紧急救援机构；不要等待应用内举报或邮件回复。</p>

      <h2>处理范围</h2>
      <p>应用内举报会进入现有内容处理流程。此页面不提供新的在线提交表单，也不会额外收集设备、定位或账号信息。具体数据处理方式请阅读<a href="/privacy">隐私与数据说明</a>。</p>
    </DocumentShell>
  );
}
