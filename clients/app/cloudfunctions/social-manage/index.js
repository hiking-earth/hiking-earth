// Legacy callable entry point intentionally fails closed. All current social
// operations are routed through client-api after unified account validation.
exports.main = async () => ({
  errMsg: '社区服务已切换到统一账号，请更新应用并登录徒步地球账号后重试',
  code: 'UNIFIED_ACCOUNT_REQUIRED',
});
