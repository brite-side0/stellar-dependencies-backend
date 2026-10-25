'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  validateRepositoryUrl,
  validateManifestPath,
  ALLOWED_HOSTS,
} = require('../src/scanner');

// ---------------------------------------------------------------------------
// Repository URL validation
// ---------------------------------------------------------------------------

test('validateRepositoryUrl accepts well-formed GitHub URLs', () => {
  const valid = [
    'https://github.com/owner/repo',
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo/',
    'https://github.com/owner/repo.git/',
    'https://github.com/owner-name/repo_name',
    'https://github.com/owner.name/repo.name',
    'https://github.com/owner/repo/tree/main',
    'https://github.com/owner/repo/blob/main/package.json',
  ];

  for (const url of valid) {
    const result = validateRepositoryUrl(url);
    assert.strictEqual(result.ok, true, `expected valid: ${url}`);
    assert.strictEqual(result.host, 'github.com', `host for ${url}`);
  }
});

test('validateRepositoryUrl rejects non-GitHub hosts', () => {
  const invalid = [
    'https://gitlab.com/owner/repo',
    'https://bitbucket.org/owner/repo',
    'https://example.com/owner/repo',
    'https://github.com.evil.com/owner/repo',
    'https://evilgithub.com/owner/repo',
    'https://github.com.evil.com/owner/repo',
    'https://notgithub.com/owner/repo',
    'https://raw.githubusercontent.com/owner/repo/main/file',
    'https://codeload.github.com/owner/repo/tar.gz/main',
    'http://github.com/owner/repo',
    'ftp://github.com/owner/repo',
    'git://github.com/owner/repo',
    'ssh://git@github.com/owner/repo',
    'git@github.com:owner/repo.git',
  ];

  for (const url of invalid) {
    const result = validateRepositoryUrl(url);
    assert.strictEqual(result.ok, false, `expected invalid: ${url}`);
    assert.ok(result.error, `expected error message for: ${url}`);
  }
});

test('validateRepositoryUrl rejects userinfo in URL', () => {
  const invalid = [
    'https://user:pass@github.com/owner/repo',
    'https://user@github.com/owner/repo',
    'https://user:pass@github.com/owner/repo.git',
    'https://token@github.com/owner/repo',
    'https://user:pass@evil.com/owner/repo',
  ];

  for (const url of invalid) {
    const result = validateRepositoryUrl(url);
    assert.strictEqual(result.ok, false, `expected invalid (userinfo): ${url}`);
  }
});

test('validateRepositoryUrl rejects explicit ports', () => {
  const invalid = [
    'https://github.com:443/owner/repo',
    'https://github.com:80/owner/repo',
    'https://github.com:8080/owner/repo',
    'https://github.com:22/owner/repo',
    'http://github.com:443/owner/repo',
  ];

  for (const url of invalid) {
    const result = validateRepositoryUrl(url);
    assert.strictEqual(result.ok, false, `expected invalid (port): ${url}`);
  }
});

test('validateRepositoryUrl rejects percent-encoded characters', () => {
  const invalid = [
    'https://github.com/owner/re%70o',
    'https://github.com/%6fwner/repo',
    'https://github.com/owner/repo%2f..%2fevil',
    'https://github.com/owner/repo%00',
    'https://github.com/owner/re%2Epo',
    'https://github.com/owner/repo%20name',
    'https://github.com/owner/repo%3Ffoo',
    'https://github.com/owner/repo%23frag',
    'https://github.com/owner/repo%40evil.com',
  ];

  for (const url of invalid) {
    const result = validateRepositoryUrl(url);
    assert.strictEqual(result.ok, false, `expected invalid (encoded): ${url}`);
  }
});

test('validateRepositoryUrl handles trailing slashes consistently', () => {
  const withSlash = validateRepositoryUrl('https://github.com/owner/repo/');
  const withoutSlash = validateRepositoryUrl('https://github.com/owner/repo');

  assert.strictEqual(withSlash.ok, true);
  assert.strictEqual(withoutSlash.ok, true);
  assert.strictEqual(withSlash.host, withoutSlash.host);
  assert.strictEqual(withSlash.owner, withoutSlash.owner);
  assert.strictEqual(withSlash.repo, withoutSlash.repo);

  // Multiple trailing slashes should not be silently accepted as a different repo.
  const doubleSlash = validateRepositoryUrl('https://github.com/owner/repo//');
  assert.strictEqual(doubleSlash.ok, false, 'double trailing slash should be rejected');
});

test('validateRepositoryUrl rejects malformed inputs', () => {
  const invalid = [
    '',
    '   ',
    'not a url',
    'github.com/owner/repo',
    '/owner/repo',
    'https://',
    'https://github.com',
    'https://github.com/',
    'https://github.com/owner',
    'https://github.com/owner/',
    'https://github.com//repo',
    'https://github.com/owner//repo',
    'https://github.com/../repo',
    'https://github.com/owner/..',
    'https://github.com/owner/repo/../../etc/passwd',
    'https://github.com/owner/repo?foo=bar',
    'https://github.com/owner/repo#fragment',
    'https://github.com/owner/repo\n',
    'https://github.com/owner/repo\r\n',
    ' https://github.com/owner/repo',
    'https://github.com/owner/repo ',
    null,
    undefined,
    123,
    {},
  ];

  for (const url of invalid) {
    const result = validateRepositoryUrl(url);
    assert.strictEqual(result.ok, false, `expected invalid: ${String(url)}`);
  }
});

test('validateRepositoryUrl rejects control characters and whitespace', () => {
  const invalid = [
    'https://github.com/owner/re\tpo',
    'https://github.com/owner/re\npo',
    'https://github.com/owner/re po',
    'https://github.com/owner/re\u0000po',
    'https://github.com/owner/re\u001fpo',
  ];

  for (const url of invalid) {
    const result = validateRepositoryUrl(url);
    assert.strictEqual(result.ok, false, `expected invalid (control): ${JSON.stringify(url)}`);
  }
});

// ---------------------------------------------------------------------------
// Manifest path validation
// ---------------------------------------------------------------------------

test('validateManifestPath accepts safe relative paths', () => {
  const valid = [
    'package.json',
    'manifest.json',
    'sub/package.json',
    'sub/dir/manifest.json',
    'a/b/c/d/package.json',
    'package-lock.json',
    'composer.json',
    'requirements.txt',
  ];

  for (const p of valid) {
    const result = validateManifestPath(p);
    assert.strictEqual(result.ok, true, `expected valid: ${p}`);
  }
});

test('validateManifestPath rejects ../ traversal', () => {
  const invalid = [
    '../package.json',
    '../../package.json',
    'sub/../package.json',
    'sub/../../package.json',
    'sub/dir/../../../package.json',
    '..',
    '../',
    'a/../../b/package.json',
    'sub/..',
    'sub/../',
  ];

  for (const p of invalid) {
    const result = validateManifestPath(p);
    assert.strictEqual(result.ok, false, `expected invalid (traversal): ${p}`);
  }
});

test('validateManifestPath rejects absolute paths', () => {
  const invalid = [
    '/package.json',
    '/etc/passwd',
    '/sub/package.json',
    'C:\\package.json',
    'C:/package.json',
    '\\\\server\\share\\package.json',
    '//server/share/package.json',
  ];

  for (const p of invalid) {
    const result = validateManifestPath(p);
    assert.strictEqual(result.ok, false, `expected invalid (absolute): ${p}`);
  }
});

test('validateManifestPath rejects encoded traversal', () => {
  const invalid = [
    '%2e%2e/package.json',
    '%2E%2E/package.json',
    '..%2fpackage.json',
    '..%2Fpackage.json',
    'sub/%2e%2e/package.json',
    'sub/%2E%2E/package.json',
    '%2e%2e%2fpackage.json',
    '%2e%2e%2f%2e%2e%2fpackage.json',
    'sub/%2e%2e%2fpackage.json',
    '..%5cpackage.json',
    '%2e%2e%5cpackage.json',
  ];

  for (const p of invalid) {
    const result = validateManifestPath(p);
    assert.strictEqual(result.ok, false, `expected invalid (encoded traversal): ${p}`);
  }
});

test('validateManifestPath rejects null bytes and control characters', () => {
  const invalid = [
    'package.json\u0000',
    'package\u0000.json',
    'sub/package.json\u0000',
    'package.json\n',
    'package.json\r',
    'package\t.json',
  ];

  for (const p of invalid) {
    const result = validateManifestPath(p);
    assert.strictEqual(result.ok, false, `expected invalid (control): ${JSON.stringify(p)}`);
  }
});

test('validateManifestPath rejects malformed inputs', () => {
  const invalid = [
    '',
    '   ',
    '.',
    './',
    './package.json',
    'sub/./package.json',
    null,
    undefined,
    123,
    {},
  ];

  for (const p of invalid) {
    const result = validateManifestPath(p);
    assert.strictEqual(result.ok, false, `expected invalid: ${String(p)}`);
  }
});

// ---------------------------------------------------------------------------
// Fixed upstream hosts
// ---------------------------------------------------------------------------

test('ALLOWED_HOSTS contains only the fixed upstream hosts', () => {
  assert.ok(Array.isArray(ALLOWED_HOSTS), 'ALLOWED_HOSTS should be an array');
  assert.ok(ALLOWED_HOSTS.length > 0, 'ALLOWED_HOSTS should not be empty');

  const expected = ['github.com', 'raw.githubusercontent.com', 'api.github.com'];
  for (const host of expected) {
    assert.ok(ALLOWED_HOSTS.includes(host), `expected allowed host: ${host}`);
  }

  for (const host of ALLOWED_HOSTS) {
    assert.strictEqual(typeof host, 'string');
    assert.strictEqual(host, host.toLowerCase(), `host should be lowercase: ${host}`);
    assert.ok(!host.includes('/'), `host should not contain path: ${host}`);
    assert.ok(!host.includes(':'), `host should not contain port: ${host}`);
    assert.ok(!host.includes('@'), `host should not contain userinfo: ${host}`);
  }
});

test('validateRepositoryUrl only ever resolves to fixed upstream hosts', () => {
  const candidates = [
    'https://github.com/owner/repo',
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo/',
    'https://gitlab.com/owner/repo',
    'https://bitbucket.org/owner/repo',
    'https://example.com/owner/repo',
    'https://github.com.evil.com/owner/repo',
    'https://user:pass@github.com/owner/repo',
    'https://github.com:443/owner/repo',
    'https://github.com/owner/re%70o',
    'https://raw.githubusercontent.com/owner/repo/main/file',
    'https://api.github.com/repos/owner/repo',
    'https://codeload.github.com/owner/repo/tar.gz/main',
    'https://evil.com/owner/repo',
  ];

  for (const url of candidates) {
    const result = validateRepositoryUrl(url);
    if (result.ok) {
      assert.ok(
        ALLOWED_HOSTS.includes(result.host),
        `resolved host must be in ALLOWED_HOSTS: ${result.host} for ${url}`
      );
    } else {
      assert.ok(result.error, `rejected URL must include error: ${url}`);
    }
  }
});

test('validateRepositoryUrl never returns a host outside ALLOWED_HOSTS', () => {
  const hosts = [
    'github.com',
    'GitHub.com',
    'GITHUB.COM',
    'gitlab.com',
    'bitbucket.org',
    'example.com',
    'github.com.evil.com',
    'evilgithub.com',
    'raw.githubusercontent.com',
    'api.github.com',
    'codeload.github.com',
  ];

  for (const host of hosts) {
    const result = validateRepositoryUrl(`https://${host}/owner/repo`);
    if (result.ok) {
      assert.ok(
        ALLOWED_HOSTS.includes(result.host),
        `unexpected host accepted: ${result.host}`
      );
    }
  }
});