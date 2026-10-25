'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_PACKAGES = 100;

const DIRECT_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'];
const PEER_DEPENDENCY_FIELD = 'peerDependencies';

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