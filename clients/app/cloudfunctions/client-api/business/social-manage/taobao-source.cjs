'use strict';

const https = require('https');
const crypto = require('crypto');

const ENDPOINT = 'https://eco.taobao.com/router/rest';
const MAX_RESPONSE_BYTES = 1024 * 1024;

function configuration() {
  const appKey = String(process.env.TAOBAO_APP_KEY || '').trim();
  const appSecret = String(process.env.TAOBAO_APP_SECRET || '').trim();
  const adzoneId = String(process.env.TAOBAO_ADZONE_ID || '').trim();
  return /^\d{4,32}$/.test(appKey) && appSecret.length >= 16 && appSecret.length <= 256
    && /^\d{4,32}$/.test(adzoneId) ? { appKey, appSecret, adzoneId } : null;
}

function signature(params, secret) {
  const content = Object.keys(params).sort().map(key => `${key}${params[key]}`).join('');
  return crypto.createHmac('md5', secret).update(content, 'utf8').digest('hex').toUpperCase();
}

function requestTop(params) {
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
        if (bytes > MAX_RESPONSE_BYTES) request.destroy(new Error('淘宝 API 响应超过限制'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error('淘宝商品服务暂不可用'));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('淘宝商品服务返回格式无效')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('淘宝商品服务请求超时')));
    request.on('error', error => reject(error?.message?.includes('超过限制')
      ? error : new Error('淘宝商品服务连接失败，请稍后重试')));
    request.end(body);
  });
}

function secureAffiliateUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    const host = url.hostname.toLowerCase();
    if (!['taobao.com', 'tmall.com', 'alibaba.com', 'tb.cn'].some(domain => host === domain || host.endsWith(`.${domain}`))) return '';
    return url.href;
  } catch { return ''; }
}

function beijingTimestamp(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(now).replace('T', ' ');
}

async function search(keyword, page = 1) {
  const config = configuration();
  if (!config) throw new Error('淘宝联盟接口尚未启用；需由所有者在 CloudBase 配置 TAOBAO_APP_KEY、TAOBAO_APP_SECRET、TAOBAO_ADZONE_ID');
  const params = {
    method: 'taobao.tbk.dg.material.optional.upgrade',
    app_key: config.appKey,
    format: 'json',
    simplify: 'true',
    v: '2.0',
    sign_method: 'hmac',
    timestamp: beijingTimestamp(),
    q: keyword,
    page_no: String(page),
    page_size: '20',
    adzone_id: config.adzoneId,
    material_id: '80309',
    sort: 'total_sales_des',
  };
  params.sign = signature(params, config.appSecret);
  const response = await requestTop(params);
  const root = response?.tbk_dg_material_optional_upgrade_response;
  if (!root || response?.error_response) throw new Error('淘宝联盟没有返回可用商品；请核对接口权限及搜索条件');
  const raw = root.result_list?.map_data;
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  return rows.slice(0, 20).map(row => {
    const basic = row?.item_basic_info || {};
    const promotion = row?.publish_info || {};
    const price = row?.price_promotion_info || {};
    const link = secureAffiliateUrl(promotion.click_url || promotion.coupon_share_url);
    const rawItemId = row?.item_id;
    const itemId = typeof rawItemId === 'string' ? rawItemId
      : Number.isSafeInteger(rawItemId) && rawItemId > 0 ? String(rawItemId) : '';
    const title = typeof basic.title === 'string' ? basic.title.trim() : '';
    if (!/^\d{1,32}$/.test(itemId) || !title || title.length > 200 || !link) return null;
    const amount = String(price.final_promotion_price || price.zk_final_price || price.reserve_price || '').trim();
    const numericAmount = /^\d{1,7}(?:\.\d{1,2})?$/.test(amount) ? amount : '';
    const sales = String(basic.tk_total_sales || '').trim();
    return {
      id: crypto.createHash('sha256').update(`taobao:${itemId}`).digest('hex'),
      title,
      summary: '由淘宝联盟官方商品 API 返回的待审候选；价格与商品状态以跳转后的商品页为准。',
      category: '',
      link,
      sourceUrl: `https://item.taobao.com/item.htm?id=${encodeURIComponent(itemId)}`,
      priceHint: numericAmount ? `API 价格快照 ¥${numericAmount}${sales && /^\d{1,12}$/.test(sales) ? ` · 推广销量 ${sales}` : ''}` : '',
      itemId,
    };
  }).filter(Boolean);
}

module.exports = { configured: () => !!configuration(), search };
