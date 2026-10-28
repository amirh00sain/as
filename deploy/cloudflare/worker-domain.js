const TARGET_DOMAIN = __TARGET_DOMAIN__;
const RELAY_PATH = __RELAY_PATH__;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    if (incoming.pathname === '/_spider-health') {
      return new Response('SpiderPanel Cloudflare Worker relay is online', {
        status: TARGET_DOMAIN ? 200 : 503,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      });
    }
    const prefix = RELAY_PATH + '/';
    if (incoming.pathname !== RELAY_PATH && !incoming.pathname.startsWith(prefix)) {
      return new Response('Not Found', { status: 404 });
    }
    const uuid = decodeURIComponent(incoming.pathname.slice(prefix.length).split('/')[0] || '').toLowerCase();
    if (!UUID_RE.test(uuid)) return new Response('WebSocket route not found', { status: 404 });
    if (!TARGET_DOMAIN) return new Response('Misconfigured relay', { status: 503 });

    const upstream = new URL(`https://${TARGET_DOMAIN}${RELAY_PATH}/${encodeURIComponent(uuid)}`);
    upstream.search = incoming.search;
    const headers = new Headers(request.headers);
    headers.set('x-forwarded-proto', 'https');
    headers.set('x-forwarded-host', incoming.host);
    const cfIp = request.headers.get('cf-connecting-ip');
    if (cfIp) {
      headers.set('x-real-ip', cfIp);
      headers.set('x-forwarded-for', cfIp);
    }
    const upstreamRequest = new Request(upstream.toString(), request);
    const forwarded = new Headers(upstreamRequest.headers);
    headers.forEach((value, key) => forwarded.set(key, value));
    return fetch(new Request(upstream.toString(), { method: request.method, headers: forwarded, body: request.body, redirect: 'manual' }));
  },
};
