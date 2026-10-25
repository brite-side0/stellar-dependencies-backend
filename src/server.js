'use strict';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Build the GitHub contents API URL for a file path within a repository.
 * @param {string} owner
 * @param {string} repo
 * @param {string} filePath
 * @returns {string}
 */
function buildContentsUrl(owner, repo, filePath) {
  const encodedPath = filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo
  )}/contents/${encodedPath}`;
}

/**
 * Fetch a file's raw content from the GitHub contents API.
 * Returns null when the file does not exist (404).
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} params.filePath
 * @param {string} [params.ref]
 * @param {string} [params.token]
 * @param {Function} [params.fetchImpl]
 * @returns {Promise<string|null>}
 */
async function fetchFileContent({ owner, repo, filePath, ref, token, fetchImpl }) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) {
    throw new Error('No fetch implementation available');
  }

  let url = buildContentsUrl(owner, repo, filePath);
  if (ref) {
    url += `?ref=${encodeURIComponent(ref)}`;
  }

  const headers = {
    Accept: 'application/vnd.github.v3.raw',
    'User-Agent': 'dependency-report',
  };
  if (token) {
    headers.Authorization = `token ${token}`;
  }

  const response = await doFetch(url, { headers });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${filePath} from ${owner}/${repo}: ${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

/**
 * Determine the directory portion of a manifest path (e.g. "packages/app/package.json"
 * -> "packages/app"). Returns '' for a root-level manifest.
 * @param {string} [manifestPath]
 * @returns {string}
 */
function manifestDirectory(manifestPath) {
  if (!manifestPath) {
    return '';
  }
  const normalized = manifestPath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx === -1) {
    return '';
  }
  return normalized.slice(0, idx);
}

/**
 * Join a directory and a filename into a repo-relative path.
 * @param {string} dir
 * @param {string} name
 * @returns {string}
 */
function joinPath(dir, name) {
  if (!dir) {
    return name;
  }
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

/**
 * Parse a package-lock.json string into a map of package name -> installed version.
 * Supports lockfileVersion 2/3 ("packages") and falls back to v1 ("dependencies").
 * @param {string} content
 * @returns {Object<string, string>}
 */
function parseLockfile(content) {
  const lock = JSON.parse(content);
  const versions = {};

  if (lock && lock.packages && typeof lock.packages === 'object') {
    for (const [key, entry] of Object.entries(lock.packages)) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      if (key === '') {
        continue;
      }
      // Only consider top-level node_modules entries (direct dependencies).
      const match = /^node_modules\/(.+)$/.exec(key);
      if (!match) {
        continue;
      }
      const name = match[1];
      if (name.includes('/node_modules/')) {
        continue;
      }
      if (typeof entry.version === 'string') {
        versions[name] = entry.version;
      }
    }
    return versions;
  }

  if (lock && lock.dependencies && typeof lock.dependencies === 'object') {
    for (const [name, entry] of Object.entries(lock.dependencies)) {
      if (entry && typeof entry === 'object' && typeof entry.version === 'string') {
        versions[name] = entry.version;
      }
    }
    return versions;
  }

  return versions;
}

/**
 * Fetch and parse the lockfile for a scanned repository, returning a map of
 * direct dependency name -> installed version. Returns null when no lockfile
 * exists so callers can mark installedVersion as 'unknown'.
 *
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} [params.manifestPath] path to the package.json being scanned
 * @param {string} [params.ref] git ref / branch
 * @param {string} [params.token] GitHub token (defaults to GITHUB_TOKEN env)
 * @param {Function} [params.fetchImpl] injectable fetch for testing
 * @returns {Promise<Object<string, string>|null>}
 */
async function fetchInstalledVersions({
  owner,
  repo,
  manifestPath,
  ref,
  token,
  fetchImpl,
} = {}) {
  if (!owner || !repo) {
    throw new Error('owner and repo are required');
  }

  const authToken = token || process.env.GITHUB_TOKEN;
  const dir = manifestDirectory(manifestPath);
  const lockfilePath = joinPath(dir, 'package-lock.json');

  const content = await fetchFileContent({
    owner,
    repo,
    filePath: lockfilePath,
    ref,
    token: authToken,
    fetchImpl,
  });

  if (content === null) {
    return null;
  }

  return parseLockfile(content);
}

module.exports = {
  fetchInstalledVersions,
  parseLockfile,
  manifestDirectory,
  joinPath,
  buildContentsUrl,
  fetchFileContent,
};