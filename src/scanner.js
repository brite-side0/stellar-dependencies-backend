'use strict';

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_PACKAGES = 100;

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

module.exports = {
  scanTransitive,
  fetchMetadata,
  extractDependencies,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_PACKAGES,
};