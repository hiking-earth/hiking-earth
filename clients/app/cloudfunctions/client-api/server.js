const http = require('http');
const { main } = require('./index');
const MAX = 6 * 1024 * 1024;
http.createServer(async (request, response) => {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX) {
      response.writeHead(413, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, errMsg: '请求体超过6 MB' })); return;
    }
    chunks.push(chunk);
  }
  try {
    const result = await main({ httpMethod: request.method, headers: request.headers,
      body: Buffer.concat(chunks).toString('utf8'), isBase64Encoded: false,
      // Do not accept client-supplied forwarded IPs as a trusted rate-limit key.
      requestContext: { identity: { sourceIp: request.socket.remoteAddress || 'unknown' } },
    });
    response.writeHead(result.statusCode, result.headers); response.end(result.body);
  } catch {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: false, errMsg: '服务暂时不可用' }));
  }
}).listen(9000, '0.0.0.0');
