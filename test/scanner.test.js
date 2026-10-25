const { test } = require('node:test');
const assert = require('node:assert');

const {
  parseManifest,
  buildReport,
} = require('../src/scanner');

test('parseManifest collects peerDependencies separately from dependencies', () => {
  const manifest = {
    name: 'example-pkg',
    version: '1.0.0',
    dependencies: {
      lodash: '^4.17.21',
      express: '^4.18.2',
    },
    peerDependencies: {
      react: '^18.0.0',
      'react-dom': '^18.0.0',
    },
  };

  const result = parseManifest(manifest);

  assert.deepStrictEqual(result.dependencies, {
    lodash: '^4.17.21',
    express: '^4.18.2',
  });
  assert.deepStrictEqual(result.peerDependencies, {
    react: '^18.0.0',
    'react-dom': '^18.0.0',
  });
});

test('parseManifest returns empty peerDependencies when none are declared', () => {
  const manifest = {
    name: 'no-peers',
    version: '1.0.0',
    dependencies: {
      lodash: '^4.17.21',
    },
  };

  const result = parseManifest(manifest);

  assert.deepStrictEqual(result.dependencies, { lodash: '^4.17.21' });
  assert.deepStrictEqual(result.peerDependencies, {});
});

test('direct dependency list never mixes in peer dependencies', () => {
  const manifest = {
    name: 'mixed-pkg',
    version: '1.0.0',
    dependencies: {
      lodash: '^4.17.21',
    },
    peerDependencies: {
      react: '^18.0.0',
    },
  };

  const result = parseManifest(manifest);
  const directNames = Object.keys(result.dependencies);

  assert.deepStrictEqual(directNames, ['lodash']);
  assert.ok(!directNames.includes('react'));
});

test('report includes peer dependency section only when opt-in flag is set', () => {
  const manifest = {
    name: 'report-pkg',
    version: '1.0.0',
    dependencies: {
      lodash: '^4.17.21',
    },
    peerDependencies: {
      react: '^18.0.0',
    },
  };

  const parsed = parseManifest(manifest);

  const withPeers = buildReport(parsed, { includePeerDependencies: true });
  assert.ok(withPeers.peerDependencies);
  assert.deepStrictEqual(withPeers.peerDependencies, { react: '^18.0.0' });
  assert.deepStrictEqual(withPeers.dependencies, { lodash: '^4.17.21' });

  const withoutPeers = buildReport(parsed);
  assert.strictEqual(withoutPeers.peerDependencies, undefined);
  assert.deepStrictEqual(withoutPeers.dependencies, { lodash: '^4.17.21' });
});

test('report omits peer dependency section when opt-in flag is false', () => {
  const manifest = {
    name: 'report-pkg',
    version: '1.0.0',
    dependencies: {
      lodash: '^4.17.21',
    },
    peerDependencies: {
      react: '^18.0.0',
    },
  };

  const parsed = parseManifest(manifest);
  const report = buildReport(parsed, { includePeerDependencies: false });

  assert.strictEqual(report.peerDependencies, undefined);
  assert.deepStrictEqual(report.dependencies, { lodash: '^4.17.21' });
});