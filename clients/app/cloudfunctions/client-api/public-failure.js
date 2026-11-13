// Stable failure categories expose no SDK exception, credential or identity.
const codes = Object.freeze({
  'public-rate-limit': 'PUBLIC_RATE_LIMIT_FAILED',
  'public-session': 'PUBLIC_SESSION_CHECK_FAILED',
  'public-business': 'PUBLIC_BUSINESS_FAILED',
});
exports.classify = (error, stage) => {
  if (error?.status) return error;
  const safe = new Error('服务暂时不可用，请稍后重试');
  safe.code = codes[stage] || 'PUBLIC_REQUEST_FAILED';
  return safe;
};
