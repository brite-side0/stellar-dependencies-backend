'use strict';

const http = require('http');
const { URL } = require('url');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT, 10) || 3000;

function parseAllowedOrigins(raw) {
  const set = new Set();
  if (!raw) return set;
  for (const part of String(raw).split(',')) {
    const origin = part.trim();
    if (origin) set.add(origin);
  }
  return set;
}

const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return true;
  }
  return false;
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(payload);
}

function handleRequest(req, res) {
  applySecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    applyCorsHeaders(req, res);
    res.statusCode = 204;
    res.end();
    return;
  }

  applyCorsHeaders(req, res);

  let pathname = '/';
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = parsed.pathname;
  } catch (err) {
    sendJson(res, 400, { error: 'Bad Request' });
    return;
  }

  if (pathname === '/health' || pathname === '/healthz') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (pathname === '/scan' && req.method === 'POST') {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        req.destroy();
      }
    });
    req.on('end', () => {
      let body = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch (err) {
          sendJson(res, 400, { error: 'Invalid JSON' });
          return;
        }
      }
      try {
        const result = runScan(body);
        sendJson(res, 200, result);
      } catch (err) {
        sendJson(res, 500, { error: 'Scan failed' });
      }
    });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
}

function runScan(input) {
  let scanner;
  try {
    scanner = require('./scanner');
  } catch (err) {
    scanner = null;
  }
  if (scanner && typeof scanner.scan === 'function') {
    return scanner.scan(input);
  }
  if (scanner && typeof scanner === 'function') {
    return scanner(input);
  }
  return { scanned: true, input };
}

const server = http.createServer(handleRequest);

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`API server listening on ${HOST}:${PORT}`);
  });
}

module.exports = {
  server,
  handleRequest,
  parseAllowedOrigins,
  ALLOWED_ORIGINS,
};