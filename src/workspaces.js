'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_MANIFESTS = 100;

/**
 * Normalize the `workspaces` field of a root package.json into an array of
 * glob patterns. Supports both the array form and the `{ packages: [...] }`
 * object form. Returns an empty array when no valid patterns are present.
 *
 * @param {object} rootManifest Parsed root package.json contents.
 * @returns {string[]}
 */
function getWorkspacePatterns(rootManifest) {
  if (!rootManifest || typeof rootManifest !== 'object') {
    return [];
  }

  let workspaces = rootManifest.workspaces;

  if (workspaces && !Array.isArray(workspaces) && typeof workspaces === 'object') {
    workspaces = workspaces.packages;
  }

  if (!Array.isArray(workspaces)) {
    return [];
  }

  return workspaces.filter((pattern) => typeof pattern === 'string' && pattern.trim() !== '');
}

/**
 * Determine whether a relative path stays within the repository root.
 * Rejects absolute paths, drive letters, and any path that escapes the root
 * via `..` segments.
 *
 * @param {string} repoRoot Absolute repository root.
 * @param {string} candidate Path to validate (absolute or relative).
 * @returns {string|null} The normalized absolute path, or null if unsafe.
 */
function resolveWithinRoot(repoRoot, candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    return null;
  }

  if (path.isAbsolute(candidate) || /^[a-zA-Z]:/.test(candidate)) {
    return null;
  }

  const normalizedRoot = path.resolve(repoRoot);
  const resolved = path.resolve(normalizedRoot, candidate);

  const relative = path.relative(normalizedRoot, resolved);
  if (relative === '') {
    return resolved;
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

/**
 * Convert a workspace glob pattern into a RegExp that matches POSIX-style
 * relative paths. Supports `*`, `**`, and `?` wildcards.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
function globToRegExp(pattern) {
  const normalized = pattern.replace(/\\/g, '/').replace(/\/+$/, '');
  let regex = '^';

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];

    if (char === '*') {
      if (normalized[i + 1] === '*') {
        // `**` matches any number of path segments.
        i += 1;
        if (normalized[i + 1] === '/') {
          i += 1;
          regex += '(?:.*/)?';
        } else {
          regex += '.*';
        }
      } else {
        regex += '[^/]*';
      }
    } else if (char === '?') {
      regex += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }

  regex += '$';
  return new RegExp(regex);
}

/**
 * Recursively walk directories under `baseDir`, collecting relative POSIX
 * paths of directories that match the provided patterns. Traversal is bounded
 * by `maxDepth` and skips common heavy directories.
 *
 * @param {string} baseDir Absolute directory to walk.
 * @param {RegExp[]} matchers
 * @param {number} maxDepth
 * @returns {string[]} Matching relative POSIX directory paths.
 */
function walkForMatches(baseDir, matchers, maxDepth) {
  const matches = [];
  const skip = new Set(['node_modules', '.git']);

  function visit(currentDir, depth) {
    if (depth > maxDepth) {
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name)) {
        continue;
      }

      const absolute = path.join(currentDir, entry.name);
      const relative = path.relative(baseDir, absolute).split(path.sep).join('/');

      if (matchers.some((matcher) => matcher.test(relative))) {
        matches.push(relative);
      }

      visit(absolute, depth + 1);
    }
  }

  visit(baseDir, 0);
  return matches;
}

/**
 * Expand workspace glob patterns into a list of workspace directories that
 * contain a package.json, staying safely within the repository root.
 *
 * @param {string} repoRoot Absolute repository root.
 * @param {string[]} patterns Workspace glob patterns.
 * @param {object} [options]
 * @param {number} [options.maxManifests] Cap on returned manifests.
 * @returns {string[]} Absolute paths to workspace package.json files.
 */
function expandWorkspaceManifests(repoRoot, patterns, options = {}) {
  const maxManifests =
    Number.isInteger(options.maxManifests) && options.maxManifests > 0
      ? options.maxManifests
      : DEFAULT_MAX_MANIFESTS;

  const normalizedRoot = path.resolve(repoRoot);
  const matchers = [];
  let maxDepth = 0;

  for (const pattern of patterns) {
    const safePattern = resolveWithinRoot(normalizedRoot, pattern.replace(/\\/g, '/'));
    if (!safePattern) {
      continue;
    }
    const relativePattern = path
      .relative(normalizedRoot, safePattern)
      .split(path.sep)
      .join('/');
    if (relativePattern === '') {
      continue;
    }
    matchers.push(globToRegExp(relativePattern));
    maxDepth = Math.max(maxDepth, relativePattern.split('/').length + 2);
  }

  if (matchers.length === 0) {
    return [];
  }

  const matchedDirs = walkForMatches(normalizedRoot, matchers, maxDepth);
  const manifests = [];

  for (const dir of matchedDirs) {
    if (manifests.length >= maxManifests) {
      break;
    }

    const manifestPath = resolveWithinRoot(normalizedRoot, path.join(dir, 'package.json'));
    if (!manifestPath) {
      continue;
    }

    try {
      if (fs.statSync(manifestPath).isFile()) {
        manifests.push(manifestPath);
      }
    } catch (err) {
      // Missing manifest; skip.
    }
  }

  return manifests;
}

/**
 * Read and parse a JSON file, returning null on failure.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Collect dependency names from a manifest, across dependency sections.
 *
 * @param {object} manifest
 * @returns {string[]}
 */
function collectDependencyNames(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return [];
  }

  const sections = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];

  const names = [];
  for (const section of sections) {
    const deps = manifest[section];
    if (deps && typeof deps === 'object') {
      for (const name of Object.keys(deps)) {
        names.push(name);
      }
    }
  }

  return names;
}

/**
 * Traverse workspaces declared in the root package.json, read each workspace
 * manifest, and aggregate dependencies with deduplication.
 *
 * @param {string} repoRoot Absolute repository root.
 * @param {object} [options]
 * @param {number} [options.maxManifests] Cap on workspace manifests processed.
 * @returns {{
 *   patterns: string[],
 *   manifests: string[],
 *   dependencies: string[],
 *   truncated: boolean
 * }}
 */
function collectWorkspaceDependencies(repoRoot, options = {}) {
  const normalizedRoot = path.resolve(repoRoot);
  const maxManifests =
    Number.isInteger(options.maxManifests) && options.maxManifests > 0
      ? options.maxManifests
      : DEFAULT_MAX_MANIFESTS;

  const rootManifestPath = path.join(normalizedRoot, 'package.json');
  const rootManifest = readJsonSafe(rootManifestPath);
  const patterns = getWorkspacePatterns(rootManifest);

  if (patterns.length === 0) {
    return { patterns: [], manifests: [], dependencies: [], truncated: false };
  }

  const manifestPaths = expandWorkspaceManifests(normalizedRoot, patterns, {
    maxManifests,
  });

  const seen = new Set();
  const dependencies = [];

  for (const manifestPath of manifestPaths) {
    const manifest = readJsonSafe(manifestPath);
    for (const name of collectDependencyNames(manifest)) {
      if (!seen.has(name)) {
        seen.add(name);
        dependencies.push(name);
      }
    }
  }

  return {
    patterns,
    manifests: manifestPaths,
    dependencies,
    truncated: manifestPaths.length >= maxManifests,
  };
}

module.exports = {
  DEFAULT_MAX_MANIFESTS,
  getWorkspacePatterns,
  resolveWithinRoot,
  globToRegExp,
  expandWorkspaceManifests,
  collectDependencyNames,
  collectWorkspaceDependencies,
};