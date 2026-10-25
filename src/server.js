'use strict';

const http = require('http');
const { URL } = require('url');

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

const HOST = process.env.HOST || '0.0.0.0';
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Simple in-memory rate limiter (per client IP).
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60 * 1000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 60;

const rateLimitBuckets = new Map();

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function isRateLimited(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  let bucket = rateLimitBuckets.get(ip);

  if (!bucket || now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateLimitBuckets.set(ip, bucket);
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

// Periodically clean up stale buckets to avoid unbounded memory growth.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateLimitBuckets.entries()) {
    if (now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
      rateLimitBuckets.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  let parsedUrl;
  try {
    parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (err) {
    sendJson(res, 400, { error: 'Bad Request' });
    return;
  }

  const pathname = parsedUrl.pathname;

  // Health check endpoint: cheap liveness probe.
  // Mounted before rate limiting and performs no upstream calls or shared state access.
  if (pathname === '/healthz') {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  // Rate limiting applies to all other routes.
  if (isRateLimited(req)) {
    res.setHeader('Retry-After', Math.ceil(RATE_LIMIT_WINDOW_MS / 1000));
    sendJson(res, 429, { error: 'Too Many Requests' });
    return;
  }

  // Existing routes.
  if (pathname === '/' && req.method === 'GET') {
    sendJson(res, 200, { name: 'api', status: 'running' });
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

server.on('clientError', (err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://${HOST}:${PORT}`);
});

module.exports = {
  server,
  fetchInstalledVersions,
  parseLockfile,
  manifestDirectory,
  joinPath,
  buildContentsUrl,
  fetchFileContent,
};
