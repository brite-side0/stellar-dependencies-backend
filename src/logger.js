'use strict';

const crypto = require('crypto');

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /token|authorization|secret|password|cookie/i;

function resolveLevel(value) {
  if (typeof value !== 'string') {
    return 'info';
  }
  const normalized = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, normalized) ? normalized : 'info';
}

let currentLevel = resolveLevel(process.env.LOG_LEVEL);

function getLevel() {
  return currentLevel;
}

function setLevel(value) {
  currentLevel = resolveLevel(value);
  return currentLevel;
}

function isEnabled(level) {
  const threshold = LEVELS[currentLevel] || LEVELS.info;
  const target = LEVELS[level] || LEVELS.info;
  return target >= threshold;
}

/**
 * Recursively redact sensitive values from a value.
 * Keys matching SENSITIVE_KEY_PATTERN have their values replaced with '[REDACTED]'.
 * Authorization headers are stripped entirely.
 */
function redact(value, seen) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `[Buffer length=${value.length}]`;
  }

  const visited = seen || new WeakSet();
  if (visited.has(value)) {
    return '[Circular]';
  }
  visited.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, visited));
  }

  const result = {};
  for (const key of Object.keys(value)) {
    const item = value[key];

    if (SENSITIVE_KEY_PATTERN.test(key)) {
      // Strip Authorization headers entirely; redact other sensitive values.
      if (/authorization/i.test(key)) {
        continue;
      }
      result[key] = REDACTED;
      continue;
    }

    result[key] = redact(item, visited);
  }

  return result;
}

function write(level, message, meta) {
  if (!isEnabled(level)) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: typeof message === 'string' ? message : String(message),
  };

  if (meta && typeof meta === 'object') {
    const redacted = redact(meta);
    if (redacted && typeof redacted === 'object' && !Array.isArray(redacted)) {
      Object.assign(entry, redacted);
    } else {
      entry.data = redacted;
    }
  }

  let line;
  try {
    line = JSON.stringify(entry);
  } catch (err) {
    line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message: entry.message,
      logError: 'Failed to serialize log entry',
    });
  }

  process.stdout.write(`${line}\n`);
}

const logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  getLevel,
  setLevel,
  isEnabled,
  redact,
};

/**
 * Strip the query string from a path so query secrets are never logged.
 */
function sanitizePath(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    return '/';
  }
  const queryIndex = rawUrl.indexOf('?');
  const hashIndex = rawUrl.indexOf('#');
  let end = rawUrl.length;
  if (queryIndex !== -1) {
    end = Math.min(end, queryIndex);
  }
  if (hashIndex !== -1) {
    end = Math.min(end, hashIndex);
  }
  const path = rawUrl.slice(0, end);
  return path.length > 0 ? path : '/';
}

/**
 * Express-style middleware that assigns a request id and logs a structured
 * JSON line on response finish.
 */
function requestLogger(req, res, next) {
  const requestId = crypto.randomUUID();
  req.id = requestId;
  req.requestId = requestId;

  if (typeof res.setHeader === 'function') {
    res.setHeader('X-Request-Id', requestId);
  }

  const start = process.hrtime.bigint();

  const onFinish = () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const method = req.method || 'UNKNOWN';
    const path = sanitizePath(req.originalUrl || req.url || '/');
    const status = typeof res.statusCode === 'number' ? res.statusCode : 0;

    write('info', 'request', {
      requestId,
      method,
      path,
      status,
      durationMs: Math.round(durationMs * 1000) / 1000,
    });
  };

  if (typeof res.once === 'function') {
    res.once('finish', onFinish);
    res.once('close', onFinish);
  }

  if (typeof next === 'function') {
    next();
  }
}

module.exports = logger;
module.exports.logger = logger;
module.exports.requestLogger = requestLogger;
module.exports.redact = redact;
module.exports.sanitizePath = sanitizePath;
module.exports.LEVELS = LEVELS;