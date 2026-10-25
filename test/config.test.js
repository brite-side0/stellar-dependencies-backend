'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { loadConfig } = require('../src/config');

function withEnv(overrides, fn) {
  const saved = {};
  const keys = Object.keys(overrides);
  for (const key of keys) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

const LIMIT_KEYS = [
  'REQUEST_TIMEOUT_MS',
  'RESPONSE_SIZE_LIMIT_BYTES',
  'LOOKUP_CONCURRENCY',
  'LOG_LEVEL',
];

function clearLimits() {
  const overrides = {};
  for (const key of LIMIT_KEYS) {
    overrides[key] = undefined;
  }
  return overrides;
}

test('loadConfig returns safe defaults when env vars are absent', () => {
  withEnv(clearLimits(), () => {
    const config = loadConfig();
    assert.strictEqual(typeof config.requestTimeoutMs, 'number');
    assert.ok(config.requestTimeoutMs > 0);
    assert.strictEqual(typeof config.responseSizeLimitBytes, 'number');
    assert.ok(config.responseSizeLimitBytes > 0);
    assert.strictEqual(typeof config.lookupConcurrency, 'number');
    assert.ok(config.lookupConcurrency > 0);
    assert.strictEqual(typeof config.logLevel, 'string');
    assert.ok(config.logLevel.length > 0);
  });
});

test('loadConfig accepts valid overrides', () => {
  withEnv(
    {
      REQUEST_TIMEOUT_MS: '15000',
      RESPONSE_SIZE_LIMIT_BYTES: '1048576',
      LOOKUP_CONCURRENCY: '3',
      LOG_LEVEL: 'debug',
    },
    () => {
      const config = loadConfig();
      assert.strictEqual(config.requestTimeoutMs, 15000);
      assert.strictEqual(config.responseSizeLimitBytes, 1048576);
      assert.strictEqual(config.lookupConcurrency, 3);
      assert.strictEqual(config.logLevel, 'debug');
    }
  );
});

test('loadConfig rejects non-numeric values', () => {
  withEnv({ ...clearLimits(), REQUEST_TIMEOUT_MS: 'abc' }, () => {
    assert.throws(() => loadConfig());
  });
  withEnv({ ...clearLimits(), RESPONSE_SIZE_LIMIT_BYTES: '12kb' }, () => {
    assert.throws(() => loadConfig());
  });
  withEnv({ ...clearLimits(), LOOKUP_CONCURRENCY: 'many' }, () => {
    assert.throws(() => loadConfig());
  });
});

test('loadConfig rejects zero values', () => {
  withEnv({ ...clearLimits(), REQUEST_TIMEOUT_MS: '0' }, () => {
    assert.throws(() => loadConfig());
  });
  withEnv({ ...clearLimits(), RESPONSE_SIZE_LIMIT_BYTES: '0' }, () => {
    assert.throws(() => loadConfig());
  });
  withEnv({ ...clearLimits(), LOOKUP_CONCURRENCY: '0' }, () => {
    assert.throws(() => loadConfig());
  });
});

test('loadConfig rejects negative values', () => {
  withEnv({ ...clearLimits(), REQUEST_TIMEOUT_MS: '-1' }, () => {
    assert.throws(() => loadConfig());
  });
  withEnv({ ...clearLimits(), RESPONSE_SIZE_LIMIT_BYTES: '-100' }, () => {
    assert.throws(() => loadConfig());
  });
  withEnv({ ...clearLimits(), LOOKUP_CONCURRENCY: '-2' }, () => {
    assert.throws(() => loadConfig());
  });
});

test('loadConfig rejects out-of-range values', () => {
  withEnv({ ...clearLimits(), REQUEST_TIMEOUT_MS: '999999999999' }, () => {
    assert.throws(() => loadConfig());
  });
  withEnv({ ...clearLimits(), RESPONSE_SIZE_LIMIT_BYTES: '999999999999999' }, () => {
    assert.throws(() => loadConfig());
  });
  withEnv({ ...clearLimits(), LOOKUP_CONCURRENCY: '100000' }, () => {
    assert.throws(() => loadConfig());
  });
});

test('loadConfig rejects unknown LOG_LEVEL', () => {
  withEnv({ ...clearLimits(), LOG_LEVEL: 'verbose' }, () => {
    assert.throws(() => loadConfig());
  });
});