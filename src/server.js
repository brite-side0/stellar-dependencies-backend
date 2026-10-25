'use strict';

const http = require('http');
const { URL } = require('url');

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { requestLogger } = require('./requestLogger');
const { scanRepository } = require('./scanner');

function sendJson(res, statusCode, payload, requestId) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Request-Id': requestId,
  });
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

  return server;
}

async function handleRequest(req, res, config, logger, requestId) {
  const parsed = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && parsed.pathname === '/health') {
    sendJson(res, 200, { status: 'ok' }, requestId);
    return;
  }

  if (req.method === 'POST' && parsed.pathname === '/scan') {
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

  server.listen(config.port, () => {
    logger.info('server_started', { port: config.port });
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