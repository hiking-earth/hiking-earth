'use strict';

const https = require('https');
const crypto = require('crypto');

const ENDPOINT = 'https://api.jd.com/routerjson';
const MAX_RESPONSE_BYTES = 1024 * 1024;

function configuration() {
  const appKey = String(process.env.JD_APP_KEY || '').trim();
  const appSecret = String(process.env.JD_APP_SECRET || '').trim();
  const siteId = String(process.env.JD_SITE_ID || '').trim();
  const positionId = String(process.env.JD_POSITION_ID || '').trim();
  const signMethod = String(process.env.JD_SIGN_METHOD || 'md5').trim().toLowerCase();
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(appKey) || appSecret.length < 16 || appSecret.length > 256
      || !/^[A-Za-z0-9_-]{1,64}$/.test(siteId)
      || (positionId && !/^\d{1,32}$/.test(positionId))
      || !['md5', 'hmacmd5', 'hmacsha256'].includes(signMethod)) return null;
  if (!positionId) return null;
  return { appKey, appSecret, siteId, positionId, signMethod };
}

function sign(params, secret, method) {
  const content = Object.keys(params).filter(key => key !== 'sign').sort()
    .map(key => `${key}${params[key]}`).join('');
  if (method === 'hmacmd5') return crypto.createHmac('md5', secret).update(content, 'utf8').digest('hex').toUpperCase();
  if (method === 'hmacsha256') return crypto.createHmac('sha256', secret).update(content, 'utf8').digest('hex').toUpperCase();
  return crypto.createHash('md5').update(`${secret}${content}${secret}`, 'utf8').digest('hex').toUpperCase();
}

function timestamp(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(now).replace('T', ' ');
}

function parseObject(value) {
  if (typeof value !== 'string') return value && typeof value === 'object' ? value : null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : null; }
  catch { return null; }
}

function request(params) {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const request = https.request(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        accept: 'application/json',
      },
      timeout: 12000,
    }, response => {
      let bytes = 0;
      const chunks = [];
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) request.destroy(new Error('京东 API 响应超过限制'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error('京东联盟商品服务暂不可用'));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('京东联盟商品服务返回格式无效')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('京东联盟商品服务请求超时')));
    request.on('error', error => reject(error?.message?.includes('超过限制')
      ? error : new Error('京东联盟商品服务连接失败，请稍后重试')));
    request.end(body);
  });
}

function secureAffiliateUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
        || (url.protocol === 'https:' && url.port && url.port !== '443')
        || (url.protocol === 'http:' && url.port && url.port !== '80' && url.port !== '443')) return '';
    if (!['union-click.jd.com', 'u.jd.com', '3.cn'].includes(host)) return '';
    // JOS examples still return http click URLs. Upgrade only these allow-listed
    // JD affiliate hosts; never turn an arbitrary HTTP URL into a trusted link.
    url.protocol = 'https:';
    return url.href;
  } catch { return ''; }
}

async function callApi(config, method, payload) {
  const params = {
    method,
    app_key: config.appKey,
    timestamp: timestamp(),
    format: 'json',
    v: '1.0',
    sign_method: config.signMethod,
    '360buy_param_json': JSON.stringify(payload),
  };
  params.sign = sign(params, config.appSecret, config.signMethod);
  const response = await request(params);
  if (response?.error_response) throw new Error('京东联盟接口未授权或请求参数不符合官方契约');
  return response;
}

async function affiliateLink(config, skuId) {
  const response = await callApi(config, 'jd.union.open.promotion.common.get', {
    promotionCodeReq: {
      materialId: `https://item.jd.com/${skuId}.html`,
      siteId: config.siteId,
      positionId: Number(config.positionId),
      sceneId: 1,
    },
  });
  const envelope = parseObject(response?.jd_union_open_promotion_common_get_responce);
  const result = parseObject(envelope?.getResult);
  const data = parseObject(result?.data);
  const link = secureAffiliateUrl(data?.clickURL);
  if (String(result?.code || '') !== '200') throw new Error('京东联盟推广链接接口未返回成功结果；请核对推广位与接口权限');
  if (!link) throw new Error('京东联盟返回的点击链接不在允许的 HTTPS 域名范围内');
  return link;
}

async function search(keyword, page = 1) {
  const config = configuration();
  if (!config) throw new Error('京东联盟官方接口尚未启用；需由所有者在 CloudBase 配置 JD_APP_KEY、JD_APP_SECRET、JD_SITE_ID 和 JD_POSITION_ID，并先申请商品查询与推广链接接口权限');
  const safePage = Number.isInteger(page) && page >= 1 && page <= 50 ? page : 1;
  const goodsReqDTO = {
    keyword,
    pageIndex: safePage,
    pageSize: 20,
    sceneId: 1,
  };
  const response = await callApi(config, 'jd.union.open.goods.query', { goodsReqDTO });
  const envelope = parseObject(response?.jd_union_open_goods_query_responce);
  if (!envelope) throw new Error('京东联盟未返回可用商品；请核对应用权限和接口参数');
  const result = parseObject(envelope.queryResult);
  if (!result || String(result.code || '') !== '200') throw new Error('京东联盟商品查询未成功；请核对应用接口权限');
  const rawProducts = result.data?.goodsResp;
  const products = Array.isArray(rawProducts) ? rawProducts
    : rawProducts && typeof rawProducts === 'object' ? [rawProducts] : [];
  const candidates = [];
  for (const product of products.slice(0, 3)) {
    const rawId = product?.skuId;
    const skuId = typeof rawId === 'string' ? rawId : Number.isSafeInteger(rawId) && rawId > 0 ? String(rawId) : '';
    const title = typeof product?.skuName === 'string' ? product.skuName.trim() : '';
    if (!/^\d{1,32}$/.test(skuId) || !title || title.length > 200) continue;
    let link = '';
    try { link = await affiliateLink(config, skuId); }
    catch (error) {
      if (!candidates.length) throw error;
      continue;
    }
    if (!link) continue;
    const price = String(product?.priceInfo?.price ?? '').trim();
    const numericPrice = /^\d{1,7}(?:\.\d{1,2})?$/.test(price) ? price : '';
    candidates.push({
      id: crypto.createHash('sha256').update(`jd:${skuId}`).digest('hex'),
      title,
      summary: '由京东联盟官方商品查询与推广链接 API 返回的待审候选；价格与商品状态以跳转后的商品页为准。',
      category: '',
      link,
      sourceUrl: `https://item.jd.com/${encodeURIComponent(skuId)}.html`,
      priceHint: numericPrice ? `API 价格快照 ¥${numericPrice}` : '',
      itemId: skuId,
    });
  }
  if (products.length > 0 && candidates.length === 0) {
    throw new Error('京东商品已查询到，但未能生成 HTTPS 联盟推广链接；请核对站点、推广位及转链接口权限');
  }
  return candidates;
}

module.exports = { configured: () => !!configuration(), search };
