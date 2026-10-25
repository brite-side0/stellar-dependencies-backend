const { test } = require('node:test');
const assert = require('node:assert');
const { createLogger, requestLogger } = require('../src/logger');

function captureStream() {
  const lines = [];
  return {
    lines,
    stream: {
      write(chunk) {
        lines.push(chunk);
        return true;
      },
    },
  };
}

test('request log line is structured and redacts secrets', () => {
  const { lines, stream } = captureStream();
  const logger = createLogger({ level: 'info', stream });

  const req = {
    method: 'GET',
    url: '/api/repos?token=supersecret-token-value',
    headers: {
      authorization: 'Bearer supersecret-token-value',
      'x-request-id': 'req-123',
    },
  };
  const res = { statusCode: 200 };

  const logRequest = requestLogger(logger);
  logRequest(req, res, 42);

  assert.strictEqual(lines.length, 1);
  const raw = lines[0];
  assert.ok(!raw.includes('supersecret-token-value'), 'secret must not be logged');

  const parsed = JSON.parse(raw);
  assert.strictEqual(parsed.requestId, 'req-123');
  assert.strictEqual(parsed.method, 'GET');
  assert.strictEqual(parsed.path, '/api/repos');
  assert.strictEqual(parsed.status, 200);
  assert.strictEqual(parsed.durationMs, 42);
  assert.ok(!JSON.stringify(parsed).includes('supersecret-token-value'));
});

test('LOG_LEVEL filtering suppresses lower-level lines', () => {
  const { lines, stream } = captureStream();
  const logger = createLogger({ level: 'warn', stream });

  logger.debug('debug message');
  logger.info('info message');
  logger.warn('warn message');
  logger.error('error message');

  assert.strictEqual(lines.length, 2);
  const levels = lines.map((line) => JSON.parse(line).level);
  assert.deepStrictEqual(levels, ['warn', 'error']);
});