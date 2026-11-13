<template>
  <scroll-view scroll-y class="page">
    <view class="intro">
      <text class="eyebrow">TERMS</text>
      <text class="title">使用规则与户外安全声明</text>
      <text class="updated">更新于 2026-10-17</text>
    </view>

    <view class="section">
      <text class="heading">信息用途</text>
      <text>徒步地球用于路线发现、资料整理和行前参考，不提供通行许可、专业领队服务、救援保障或实时导航。路线开放、预约、保护区边界和天气请以属地管理部门当天发布的信息为准。</text>
    </view>
    <view class="section">
      <text class="heading">路线状态</text>
      <text>“待核验”“认知示意”和关闭路线不能作为出行依据。永久关闭或明确禁止穿越的路线不展示精确轨迹，也不开放导航、下载、推荐和约伴。路线资料、示意线与天气预报均不能证明现场安全或路线开放。</text>
    </view>
    <view class="section">
      <text class="heading">约伴规则</text>
      <view class="rule"><text class="bullet">•</text><text>活动仅限免费或 AA，不代表平台担保或保险。</text></view>
      <view class="rule"><text class="bullet">•</text><text>未成年人不能独立组织活动，报名须由监护人确认。</text></view>
      <view class="rule"><text class="bullet">•</text><text>参与者应自行评估健康、装备、保险、天气、交通和撤退方案。</text></view>
      <view class="rule"><text class="bullet">•</text><text>不得发布违法穿越、商业导流、欺诈、骚扰或泄露他人隐私的内容。</text></view>
    </view>
    <view class="section">
      <text class="heading">内容与版权</text>
      <text>用户不得上传无权使用的图片、轨迹或攻略。候选版中的演示图片和未核验路线只有在完成来源与使用许可记录后，才能进入正式发布内容。公开内容可能经过自动检查和管理员审核。</text>
    </view>
    <view class="section">
      <text class="heading">个人运营与联系</text>
      <text>本服务由项目所有者个人运营。隐私、违规内容与服务问题请联系：</text>
      <text class="email" selectable>2308582955@qq.com</text>
      <text>请提供问题类型、相关记录编号和事实说明；不要发送密码、验证码或他人的完整轨迹。争议可先通过邮件协商处理，依法保留适用法律赋予的权利。</text>
    </view>
    <view class="section">
      <text class="heading">紧急情况</text>
      <text>紧急情况请直接联系当地救援服务。应用内 SOS 不会代替报警、发送短信、联系救援机构或保证救援到达。</text>
    </view>
  </scroll-view>
</template>

<style lang="scss" scoped>
.page { min-height: 100vh; box-sizing: border-box; padding: 18px 14px 30px; background: var(--he-color-background); }
.intro { display: flex; flex-direction: column; gap: 7px; padding: 4px 2px 14px; }
.eyebrow { color: var(--he-color-accent); font-size: 10px; font-weight: 700; letter-spacing: 1.2px; }
.title { color: var(--he-color-text); font-size: 21px; font-weight: 700; }
.updated { color: var(--he-color-muted); font-size: 11px; }
.section { display: flex; flex-direction: column; gap: 7px; margin-top: 12px; padding: 13px 12px; border-radius: 10px; background: var(--he-color-panel); color: var(--he-color-muted); font-size: 12px; line-height: 1.75; }
.rule { display: flex; align-items: flex-start; gap: 7px; }
.bullet { flex: none; color: var(--he-color-accent); }
.heading { color: var(--he-color-accent); font-size: 13px; font-weight: 650; }
.email { align-self: flex-start; color: var(--he-color-accent); font-weight: 600; }
</style>
