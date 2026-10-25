'use strict';

const http = require('http');
const { URL } = require('url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Simple in-memory rate limiter (per client IP).
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 60;

const rateLimitBuckets = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function isRateLimited(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  let bucket = rateLimitBuckets.get(ip);

  if (!bucket || now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateLimitBuckets.set(ip, bucket);
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

// Periodically clean up stale buckets to avoid unbounded memory growth.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitBuckets.entries()) {
    if (now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (err) {
    sendJson(res, 400, { error: 'Bad Request' });
    return;
  }

  const pathname = parsedUrl.pathname;

  // Health check endpoint: cheap liveness probe.
  // Mounted before rate limiting and performs no upstream calls or shared state access.
  if (pathname === '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  // Rate limiting applies to all other routes.
  if (isRateLimited(req)) {
    res.setHeader('Retry-After', Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    sendJson(res, 429, { error: 'Too Many Requests' });
    return;
  }

  // Existing routes.
  if (pathname === '/' && req.method === 'GET') {
    sendJson(res, 200, { name: 'api', status: 'running' });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.on('clientError', (err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://${HOST}:${PORT}`);
});

module.exports = server;