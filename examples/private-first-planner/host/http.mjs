import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { requireThat } from '../contracts.mjs';

export async function serveHost(host, { token, port = 0 }) {
  requireThat(typeof token === 'string' && token.length >= 32);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const actual = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
      if (req.headers.origin || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        res.writeHead(403); res.end('{"error":"forbidden"}'); return;
      }
      if (req.method === 'GET' && req.url === '/state') { res.end(JSON.stringify(host.snapshot())); return; }
      if (req.method === 'POST' && req.url === '/commands') {
        requireThat(req.headers['content-type'] === 'application/json');
        let body = ''; for await (const chunk of req) { body += chunk; requireThat(Buffer.byteLength(body) <= 16 * 1024); }
        const receipt = host.command(JSON.parse(body)); res.writeHead(202); res.end(JSON.stringify(receipt)); return;
      }
      res.writeHead(404); res.end('{"error":"not_found"}');
    } catch { res.writeHead(409); res.end('{"error":"invalid_or_stale_command"}'); }
  });
  server.requestTimeout = 10_000; server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
