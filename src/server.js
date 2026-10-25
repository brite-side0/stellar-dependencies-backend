'use strict';

const http = require('http');
const { URL } = require('url');

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { requestLogger } = require('./requestLogger');
const { scanRepository } = require('./scanner');

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

function sendJson(res, statusCode, payload, requestId) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  };
  if (requestId) {
    headers['X-Request-Id'] = requestId;
  }
  res.writeHead(statusCode, headers);
  res.end(body);
}

function createServer(config, logger) {
  const server = http.createServer((req, res) => {
    const start = process.hrtime.bigint();
    const requestId = req.headers['x-request-id'] || generateRequestId();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info('request', {
        requestId,
        method: req.method,
        path: req.url,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 1000) / 1000,
      });
    });

    handleRequest(req, res, config, logger, requestId).catch((err) => {
      logger.error('unhandled_error', {
        requestId,
        message: err && err.message ? err.message : String(err),
      });
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal_error' }, requestId);
      } else {
        res.end();
      }
    });
  });

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = config.requestTimeoutMs;
  server.keepAliveTimeout = config.requestTimeoutMs;

  server.on('clientError', (err, socket) => {
    if (socket.writable) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    }
  });

  return server;
}

async function handleRequest(req, res, config, logger, requestId) {
  let parsed;
  try {
    parsed = new URL(req.url, 'http://localhost');
  } catch (err) {
    sendJson(res, 400, { error: 'Bad Request' }, requestId);
    return;
  }

  const pathname = parsed.pathname;

  // Health check endpoint: cheap liveness probe.
  // Mounted before rate limiting and performs no upstream calls or shared state access.
  if (pathname === '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(res, 405, { error: 'Method Not Allowed' }, requestId);
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      });
      res.end();
      return;
    }
    sendJson(res, 200, { status: 'ok' }, requestId);
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { status: 'ok' }, requestId);
    return;
  }

  // Rate limiting applies to all other routes.
  if (isRateLimited(req)) {
    res.setHeader('Retry-After', Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    sendJson(res, 429, { error: 'Too Many Requests' }, requestId);
    return;
  }

  if (pathname === '/' && req.method === 'GET') {
    sendJson(res, 200, { name: 'api', status: 'running' }, requestId);
    return;
  }

  if (req.method === 'POST' && pathname === '/scan') {
    const body = await readBody(req, config.maxRequestBytes);
    let payload;
    try {
      payload = body.length ? JSON.parse(body) : {};
    } catch (err) {
      sendJson(res, 400, { error: 'invalid_json' }, requestId);
      return;
    }

    const repository = payload && payload.repository;
    if (typeof repository !== 'string' || repository.length === 0) {
      sendJson(res, 400, { error: 'missing_repository' }, requestId);
      return;
    }

    const result = await scanRepository(repository, {
      token: config.githubToken,
      concurrency: config.lookupConcurrency,
      maxResponseBytes: config.maxResponseBytes,
      requestTimeoutMs: config.requestTimeoutMs,
    });

    sendJson(res, 200, result, requestId);
    return;
  }

  sendJson(res, 404, { error: 'not_found' }, requestId);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;

    const finish = (err, value) => {
      if (done) return;
      done = true;
      if (err) reject(err);
      else resolve(value);
    };

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        finish(new Error('request_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => finish(err));
  });
}

function generateRequestId() {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  );
}

function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: 'fatal',
        message: 'invalid_configuration',
        error: err && err.message ? err.message : String(err),
      }) + '\n'
    );
    process.exit(1);
    return;
  }

  const logger = createLogger({ level: config.logLevel });
  const server = createServer(config, logger);

  const host = process.env.HOST || '0.0.0.0';

  server.listen(config.port, host, () => {
    logger.info('server_started', { port: config.port, host });
  });

  const shutdown = (signal) => {
    logger.info('server_stopping', { signal });
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main();
}

module.exports = { createServer, handleRequest, main };
