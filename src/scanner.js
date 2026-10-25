'use strict';

const fs = require('fs');
const path = require('path');

const config = require('./config');

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_PACKAGES = 100;

const ALLOWED_HOSTS = Object.freeze([
  'api.github.com',
  'raw.githubusercontent.com',
  'registry.npmjs.org',
]);

const GITHUB_HOST = 'api.github.com';

const DIRECT_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'];
const PEER_DEPENDENCY_FIELD = 'peerDependencies';

function isAllowedHost(hostname) {
  return ALLOWED_HOSTS.includes(hostname);
}

/**
 * Validate a repository URL. Only GitHub repository URLs are accepted.
 * Rejects non-GitHub hosts, userinfo, explicit ports, encoded characters
 * and trailing-slash variants.
 *
 * Returns { owner, repo } on success, throws on invalid input.
 */
function parseRepositoryUrl(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Repository URL must be a non-empty string');
  }

  // Reject any percent-encoding outright.
  if (/%[0-9a-fA-F]{2}/.test(input)) {
    throw new Error('Repository URL must not contain encoded characters');
  }

  // Reject trailing slashes (including multiple).
  if (/\/+$/.test(input)) {
    throw new Error('Repository URL must not have a trailing slash');
  }

  let url;
  try {
    url = new URL(input);
  } catch (err) {
    throw new Error('Repository URL is not a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Repository URL must use https');
  }

  // Reject userinfo (user:pass@host).
  if (url.username !== '' || url.password !== '') {
    throw new Error('Repository URL must not contain userinfo');
  }

  // Reject explicit ports.
  if (url.port !== '') {
    throw new Error('Repository URL must not specify a port');
  }

  // Only GitHub hosts are allowed for repository URLs.
  if (url.hostname !== GITHUB_HOST) {
    throw new Error('Repository URL must point to github.com');
  }

  if (!isAllowedHost(url.hostname)) {
    throw new Error('Repository URL host is not allowed');
  }

  // Expect exactly /owner/repo.
  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length !== 2) {
    throw new Error('Repository URL must be of the form https://github.com/owner/repo');
  }

  const [owner, repo] = segments;

  if (!/^[A-Za-z0-9_.-]+$/.test(owner)) {
    throw new Error('Repository owner contains invalid characters');
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('Repository name contains invalid characters');
  }
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    throw new Error('Repository URL contains invalid path segments');
  }

  return { owner, repo };
}

/**
 * Validate a manifest path within a repository. Rejects absolute paths,
 * '../' traversal, encoded characters and empty segments.
 */
function validateManifestPath(input) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Manifest path must be a non-empty string');
  }

  if (/%[0-9a-fA-F]{2}/.test(input)) {
    throw new Error('Manifest path must not contain encoded characters');
  }

  if (input.startsWith('/') || input.startsWith('\\')) {
    throw new Error('Manifest path must be relative');
  }

  if (/^[A-Za-z]:[\\/]/.test(input)) {
    throw new Error('Manifest path must not be an absolute Windows path');
  }

  if (input.includes('\\')) {
    throw new Error('Manifest path must use forward slashes');
  }

  const segments = input.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error('Manifest path must not contain empty, "." or ".." segments');
    }
  }

  return input;
}

/**
 * Build a URL for a fixed upstream host, asserting the host is allowed.
 */
function buildUpstreamUrl(hostname, pathname) {
  if (!isAllowedHost(hostname)) {
    throw new Error(`Upstream host not allowed: ${hostname}`);
  }
  const url = new URL(`https://${hostname}${pathname}`);
  if (url.hostname !== hostname) {
    throw new Error('Upstream URL host mismatch');
  }
  return url.toString();
}

/**
 * Fetch with a configurable timeout and response size limit.
 * Only allowed upstream hosts may be contacted.
 */
async function fetchWithLimits(urlString, options = {}) {
  const url = new URL(urlString);
  if (!isAllowedHost(url.hostname)) {
    throw new Error(`Refusing to contact disallowed host: ${url.hostname}`);
  }

  const timeoutMs = options.timeoutMs != null ? options.timeoutMs : config.requestTimeoutMs;
  const maxResponseBytes =
    options.maxResponseBytes != null ? options.maxResponseBytes : config.maxResponseBytes;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(urlString, {
      ...options.fetchOptions,
      signal: controller.signal,
    });

    const contentLength = response.headers.get('content-length');
    if (contentLength != null) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > maxResponseBytes) {
        throw new Error('Response exceeds maximum allowed size');
      }
    }

    const reader = response.body && response.body.getReader ? response.body.getReader() : null;
    if (!reader) {
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) {
        throw new Error('Response exceeds maximum allowed size');
      }
      return { status: response.status, headers: response.headers, body: text };
    }

    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxResponseBytes) {
        try {
          await reader.cancel();
        } catch (_) {
          // ignore
        }
        throw new Error('Response exceeds maximum allowed size');
      }
      chunks.push(Buffer.from(value));
    }

    const body = Buffer.concat(chunks).toString('utf8');
    return { status: response.status, headers: response.headers, body };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run tasks with bounded concurrency using the configured lookup concurrency.
 */
async function mapWithConcurrency(items, worker, concurrency) {
  const limit = concurrency != null ? concurrency : config.lookupConcurrency;
  const results = new Array(items.length);
  let index = 0;

  async function run() {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = [];
  const workerCount = Math.min(limit, items.length);
  for (let i = 0; i < workerCount; i += 1) {
    runners.push(run());
  }
  await Promise.all(runners);
  return results;
}

/**
 * Fetch package metadata from the npm registry.
 * @param {string} name
 * @param {string} version
 * @param {Function} [fetchImpl] - injectable fetch for testing
 * @returns {Promise<Object>} registry metadata
 */
async function fetchMetadata(name, version, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('No fetch implementation available');
  }
  const spec = version ? `${name}@${version}` : name;
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(
    version || 'latest'
  )}`;
  const res = await doFetch(url, { headers: { accept: 'application/json' } });
  if (!res || !res.ok) {
    throw new Error(`Failed to fetch metadata for ${spec}`);
  }
  return res.json();
}

/**
 * Extract dependency names from registry metadata.
 * @param {Object} metadata
 * @returns {string[]}
 */
function extractDependencies(metadata) {
  if (!metadata || typeof metadata !== 'object') return [];
  const deps = metadata.dependencies;
  if (!deps || typeof deps !== 'object') return [];
  return Object.keys(deps);
}

/**
 * Perform an opt-in breadth-first traversal of transitive dependencies.
 *
 * @param {Array<{name: string, version?: string}>} roots - root packages
 * @param {Object} [options]
 * @param {number} [options.maxDepth=DEFAULT_MAX_DEPTH] - maximum traversal depth
 * @param {number} [options.maxPackages=DEFAULT_MAX_PACKAGES] - total package cap
 * @param {Function} [options.fetchImpl] - injectable fetch for testing
 * @param {Function} [options.getDependencies] - injectable dependency resolver
 * @returns {Promise<Array<{name: string, version: string, depth: number}>>}
 */
async function scanTransitive(roots, options = {}) {
  const maxDepth =
    Number.isInteger(options.maxDepth) && options.maxDepth >= 0
      ? options.maxDepth
      : DEFAULT_MAX_DEPTH;
  const maxPackages =
    Number.isInteger(options.maxPackages) && options.maxPackages >= 0
      ? options.maxPackages
      : DEFAULT_MAX_PACKAGES;

  const fetchImpl = options.fetchImpl;
  const getDependencies = options.getDependencies;

  const results = [];
  const seen = new Set();
  const queue = [];

  const rootList = Array.isArray(roots) ? roots : [];
  for (const root of rootList) {
    if (!root || typeof root.name !== 'string' || root.name.length === 0) continue;
    const version = typeof root.version === 'string' ? root.version : '';
    const key = `${root.name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push({ name: root.name, version, depth: 0 });
  }

  let head = 0;
  while (head < queue.length) {
    if (results.length >= maxPackages) break;

    const current = queue[head++];
    results.push({
      name: current.name,
      version: current.version,
      depth: current.depth,
    });

    if (current.depth >= maxDepth) continue;

    let depNames = [];
    try {
      if (typeof getDependencies === 'function') {
        depNames = await getDependencies(current.name, current.version);
      } else {
        const metadata = await fetchMetadata(current.name, current.version, fetchImpl);
        depNames = extractDependencies(metadata);
      }
    } catch (err) {
      depNames = [];
    }

    if (!Array.isArray(depNames)) depNames = [];

    for (const depName of depNames) {
      if (typeof depName !== 'string' || depName.length === 0) continue;
      const key = `${depName}@`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ name: depName, version: '', depth: current.depth + 1 });
    }
  }

  return results;
}

/**
 * Read and parse a package manifest (package.json) from disk.
 *
 * @param {string} manifestPath Path to the package.json file.
 * @returns {object} The parsed manifest contents.
 */
function readManifest(manifestPath) {
  const resolvedPath = path.resolve(manifestPath);
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Normalize a dependency map into a sorted array of { name, version } entries.
 *
 * @param {object} deps Dependency map from a manifest.
 * @returns {Array<{name: string, version: string}>}
 */
function normalizeDependencies(deps) {
  if (!deps || typeof deps !== 'object') {
    return [];
  }

  return Object.keys(deps)
    .sort()
    .map((name) => ({ name, version: deps[name] }));
}

/**
 * Collect the direct dependencies (dependencies + devDependencies) from a manifest.
 * Peer dependencies are intentionally excluded from this collection.
 *
 * @param {object} manifest Parsed package manifest.
 * @returns {Array<{name: string, version: string, type: string}>}
 */
function collectDirectDependencies(manifest) {
  const result = [];

  for (const field of DIRECT_DEPENDENCY_FIELDS) {
    const entries = normalizeDependencies(manifest[field]);
    for (const entry of entries) {
      result.push({ ...entry, type: field });
    }
  }

  return result;
}

/**
 * Collect the peer dependencies from a manifest.
 *
 * @param {object} manifest Parsed package manifest.
 * @returns {Array<{name: string, version: string, type: string}>}
 */
function collectPeerDependencies(manifest) {
  return normalizeDependencies(manifest[PEER_DEPENDENCY_FIELD]).map((entry) => ({
    ...entry,
    type: PEER_DEPENDENCY_FIELD,
  }));
}

/**
 * Scan a package manifest and return its direct and peer dependencies
 * as two distinct collections.
 *
 * @param {string|object} manifestOrPath Either a path to a package.json file
 *   or an already-parsed manifest object.
 * @returns {{directDependencies: Array, peerDependencies: Array}}
 */
function scanManifest(manifestOrPath) {
  const manifest =
    typeof manifestOrPath === 'string'
      ? readManifest(manifestOrPath)
      : manifestOrPath || {};

  return {
    directDependencies: collectDirectDependencies(manifest),
    peerDependencies: collectPeerDependencies(manifest),
  };
}

module.exports = {
  ALLOWED_HOSTS,
  GITHUB_HOST,
  isAllowedHost,
  parseRepositoryUrl,
  validateManifestPath,
  buildUpstreamUrl,
  fetchWithLimits,
  mapWithConcurrency,
  scanTransitive,
  fetchMetadata,
  extractDependencies,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PACKAGES,
  DIRECT_DEPENDENCY_FIELDS,
  PEER_DEPENDENCY_FIELD,
  readManifest,
  normalizeDependencies,
  collectDirectDependencies,
  collectPeerDependencies,
  scanManifest,
};