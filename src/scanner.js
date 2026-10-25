'use strict';

const fs = require('fs');
const path = require('path');

const DIRECT_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies'];
const PEER_DEPENDENCY_FIELD = 'peerDependencies';

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
  DIRECT_DEPENDENCY_FIELDS,
  PEER_DEPENDENCY_FIELD,
  readManifest,
  normalizeDependencies,
  collectDirectDependencies,
  collectPeerDependencies,
  scanManifest,
};