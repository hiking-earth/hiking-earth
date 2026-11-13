# 导购官方接入证据与剩余依赖

查阅日期：2026-10-23。仅官方资料作为契约依据，没有平台API请求、账号申请或生产验收。

## 拼多多

- 官方历史说明：https://commoncdn.yangkeduo.com/pdd_oms/2021-01-12/2e22638bda0b0f77479f89dab1de2988.pdf
- 说明中有pdd.ddk.goods.search、goods_sign和pdd.ddk.goods.promotion.url.generate流程，但这是2021历史文档，不能证明2026当前请求字段、签名规则、配额和资格仍相同。
- 当前官方API入口：https://open.pinduoduo.com/application/document/api?id=pdd.ddk.goods.search 以及对应promotion.url.generate页；本轮读取失败，不使用第三方SDK猜作当前官方契约。
- 真正外部依赖：具备权限账号持有人在官方控制台确认可用API包并提供非敏感参数文档（不发secret/token）；开发端再按该文档实现当前准确适配。现有淘宝/京东通用候选审核与有效期流程可复用，但不能声称拼多多已接通。

## 闲鱼

- 官方快速接入：https://open.goofish.com/doc/quick-start.html
- 官方常见问题：https://open.goofish.com/doc/development/other/questions.html
- 快速接入明确其小程序入口为定向邀请，要求企业及相同签约主体、平台权限审批；这些不是本项目个人主体自动可获的通用商品搜索权限。
- 只有用户取得合作资格、对应商品接口授权和官方契约后才能接入。不能从小程序订单等API推导通用联盟搜索，也不能以爬取或人工录入冒充API。
- 管理页调整为仅陈述已核实要求；不再将未在本轮文档核实的聚石塔笼统写作全部闲鱼接口必需条件。

## 代码边界

淘宝/京东已有官方适配源码，仍需本人资格及服务端凭据。拼多多/闲鱼本轮未实现可调用生产适配器，不生成假响应，不启用付费服务；管理端明确显示尚未接通，已授权商品人工登记是独立能力。待拿到当前正式契约后的适配工作仍由开发端承担。
