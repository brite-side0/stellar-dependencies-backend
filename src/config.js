'use strict';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

const DEFAULTS = Object.freeze({
  LOG_LEVEL: 'info',
  REQUEST_TIMEOUT_MS: 10000,
  MAX_RESPONSE_BYTES: 5000000,
  LOOKUP_CONCURRENCY: 6,
});

const RANGES = Object.freeze({
  REQUEST_TIMEOUT_MS: { min: 1000, max: 120000 },
  MAX_RESPONSE_BYTES: { min: 1024, max: 50000000 },
  LOOKUP_CONCURRENCY: { min: 1, max: 32 },
});

function parsePositiveInt(name, raw, range) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Invalid ${name}: "${raw}" is not a positive integer`
    );
  }
  if (value < range.min || value > range.max) {
    throw new Error(
      `Invalid ${name}: ${value} is out of range (${range.min}-${range.max})`
    );
  }
  return value;
}

function loadConfig(env = process.env) {
  const source = env || {};

  const rawLogLevel = source.LOG_LEVEL;
  let logLevel;
  if (rawLogLevel === undefined || rawLogLevel === '') {
    logLevel = DEFAULTS.LOG_LEVEL;
  } else {
    logLevel = String(rawLogLevel).toLowerCase();
    if (!LOG_LEVELS.includes(logLevel)) {
      throw new Error(
        `Invalid LOG_LEVEL: "${rawLogLevel}" (expected one of ${LOG_LEVELS.join(', ')})`
      );
    }
  }

  const readNumeric = (name) => {
    const raw = source[name];
    if (raw === undefined || raw === '') {
      return DEFAULTS[name];
    }
    return parsePositiveInt(name, raw, RANGES[name]);
  };

  return {
    logLevel,
    requestTimeoutMs: readNumeric('REQUEST_TIMEOUT_MS'),
    maxResponseBytes: readNumeric('MAX_RESPONSE_BYTES'),
    lookupConcurrency: readNumeric('LOOKUP_CONCURRENCY'),
  };
}

module.exports = {
  loadConfig,
  DEFAULTS,
  RANGES,
  LOG_LEVELS,
};