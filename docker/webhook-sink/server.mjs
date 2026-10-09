// Stand-in for a training center's webhook endpoint. Logs every delivery and keeps the last
// ones in memory so the demo and the trace tooling can show what was received.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 9099);
const KEEP = 200;
const MAX_BODY_BYTES = 1024 * 1024;
const deliveries = [];

const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/deliveries')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: deliveries }));
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(204).end();
    return;
  }

  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const delivery = {
      receivedAt: new Date().toISOString(),
      method: req.method,
      path: req.url,
      deliveryId: req.headers['x-tramo-delivery-id'] ?? null,
      event: req.headers['x-tramo-event'] ?? null,
      signature: req.headers['x-tramo-signature'] ?? null,
      body: safeJson(body),
    };
    deliveries.unshift(delivery);
    deliveries.length = Math.min(deliveries.length, KEEP);
    process.stdout.write(`${JSON.stringify(delivery)}\n`);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"received":true}');
  });
});

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

server.listen(PORT, () => process.stdout.write(`webhook-sink listening on ${PORT}\n`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
