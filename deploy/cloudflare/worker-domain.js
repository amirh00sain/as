const TARGET_DOMAIN = __TARGET_DOMAIN__;
const RELAY_PATH = __RELAY_PATH__;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function healthResponse() {
  return new Response('SpiderPanel Cloudflare Worker relay is online', {
    status: TARGET_DOMAIN ? 200 : 503,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

export default {
  async fetch(request) {
    try {
      const incoming = new URL(request.url);
      if (incoming.pathname === '/_spider-health') return healthResponse();
      if (incoming.pathname === '/') return healthResponse();

      const prefix = `${RELAY_PATH}/`;
      if (incoming.pathname !== RELAY_PATH && !incoming.pathname.startsWith(prefix)) {
        return new Response('Not Found', { status: 404 });
      }
      if (request.method !== 'GET') return new Response('WebSocket upgrade required', { status: 426 });

      const upgrade = request.headers.get('Upgrade');
      if (!upgrade || upgrade.toLowerCase() !== 'websocket') {
        return new Response('WebSocket upgrade required', {
          status: 426,
          headers: { 'upgrade': 'websocket', 'cache-control': 'no-store' },
        });
      }

      const rawUuid = incoming.pathname.slice(prefix.length).split('/')[0] || '';
      const uuid = decodeURIComponent(rawUuid).toLowerCase();
      if (!UUID_RE.test(uuid)) return new Response('WebSocket route not found', { status: 404 });
      if (!TARGET_DOMAIN) return new Response('Misconfigured relay', { status: 503 });

      const upstream = new URL(`https://${TARGET_DOMAIN}${RELAY_PATH}/${encodeURIComponent(uuid)}`);
      upstream.search = incoming.search;

      // Cloudflare documents outbound WebSocket connections through fetch()
      // with Upgrade: websocket. Do not forward the edge Host header: fetch
      // must set Host to the upstream panel domain.
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('sec-websocket-key');
      headers.delete('sec-websocket-version');
      headers.delete('sec-websocket-extensions');
      headers.delete('cf-connecting-ip');
      headers.set('upgrade', 'websocket');
      headers.set('x-forwarded-proto', 'https');
      headers.set('x-forwarded-host', incoming.host);
      const clientIp = request.headers.get('cf-connecting-ip');
      if (clientIp) {
        headers.set('x-real-ip', clientIp);
        headers.set('x-forwarded-for', clientIp);
      }

      const response = await fetch(upstream.toString(), { method: 'GET', headers, redirect: 'manual' });
      if (response.status !== 101) {
        console.error('Upstream WebSocket handshake failed', response.status, upstream.hostname, upstream.pathname);
      }
      return response;
    } catch (error) {
      const message = String(error && error.stack || error || 'Unknown Worker error').slice(0, 1200);
      console.error('SpiderPanel Worker relay exception:', message);
      return new Response(`Worker relay error: ${message}`, {
        status: 502,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'access-control-allow-origin': '*',
        },
      });
    }
  },
};
