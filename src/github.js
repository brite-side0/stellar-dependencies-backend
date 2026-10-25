'use strict';

const GITHUB_API_BASE = 'https://api.github.com';
const MAX_REF_LENGTH = 255;
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/;

/**
 * Error thrown when a GitHub ref (branch, tag or commit) is invalid.
 */
class InvalidRefError extends Error {
  constructor(ref, reason) {
    super(`Invalid ref "${ref}": ${reason}`);
    this.name = 'InvalidRefError';
    this.code = 'INVALID_REF';
    this.ref = ref;
  }
}

/**
 * Error thrown when GitHub API rate limits are hit.
 */
class GitHubRateLimitError extends Error {
  constructor({ resetTime, retryAfter, status, message }) {
    const parts = ['GitHub API rate limit exceeded.'];
    if (resetTime) {
      parts.push(`Rate limit resets at ${resetTime.toISOString()}.`);
    }
    if (retryAfter != null) {
      parts.push(`Retry after ${retryAfter} second(s).`);
    }
    parts.push('Set the GITHUB_TOKEN environment variable to authenticate and raise your rate limit.');
    if (message) {
      parts.push(`(${message})`);
    }
    super(parts.join(' '));
    this.name = 'GitHubRateLimitError';
    this.code = 'GITHUB_RATE_LIMIT';
    this.status = status;
    this.resetTime = resetTime || null;
    this.retryAfter = retryAfter != null ? retryAfter : null;
    // Rate-limit errors must not be retried automatically.
    this.retryable = false;
  }
}

/**
 * Validate an optional ref (branch, tag or commit SHA).
 * Returns the normalized ref, or null when omitted.
 */
function validateRef(ref) {
  if (ref == null) {
    return null;
  }
  if (typeof ref !== 'string') {
    throw new InvalidRefError(String(ref), 'ref must be a string');
  }
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    throw new InvalidRefError(ref, 'ref must not be empty');
  }
  if (trimmed.length > MAX_REF_LENGTH) {
    throw new InvalidRefError(ref, `ref must be at most ${MAX_REF_LENGTH} characters`);
  }
  if (!REF_PATTERN.test(trimmed)) {
    throw new InvalidRefError(ref, 'ref may only contain letters, digits, ".", "_", "/" and "-"');
  }
  if (trimmed.includes('..')) {
    throw new InvalidRefError(ref, 'ref must not contain ".."');
  }
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
    throw new InvalidRefError(ref, 'ref must not start or end with "/"');
  }
  if (trimmed.startsWith('-')) {
    throw new InvalidRefError(ref, 'ref must not start with "-"');
  }
  return trimmed;
}

/**
 * Parse rate-limit related headers from a response.
 */
function parseRateLimitHeaders(headers) {
  const get = (name) => {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(name);
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    return key ? headers[key] : null;
  };

  const remainingRaw = get('x-ratelimit-remaining');
  const resetRaw = get('x-ratelimit-reset');
  const retryAfterRaw = get('retry-after');

  const remaining = remainingRaw != null ? Number(remainingRaw) : null;
  const resetSeconds = resetRaw != null ? Number(resetRaw) : null;
  const retryAfter = retryAfterRaw != null ? Number(retryAfterRaw) : null;

  let resetTime = null;
  if (resetSeconds != null && Number.isFinite(resetSeconds)) {
    resetTime = new Date(resetSeconds * 1000);
  }

  return {
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetTime,
    retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
  };
}

/**
 * Determine whether a response indicates a rate limit was hit.
 */
function isRateLimited(status, headers) {
  if (status !== 403 && status !== 429) {
    return false;
  }
  const { remaining, retryAfter } = parseRateLimitHeaders(headers);
  if (remaining === 0) {
    return true;
  }
  if (retryAfter != null) {
    return true;
  }
  // A 429 is always treated as a rate limit.
  return status === 429;
}

/**
 * Build the contents API URL for a path, optionally scoped to a ref.
 */
function buildContentsUrl({ owner, repo, path, ref }) {
  const cleanPath = String(path || '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  const encodedPath = cleanPath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
  const base = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents`;
  const url = encodedPath ? `${base}/${encodedPath}` : base;
  if (ref) {
    return `${url}?ref=${encodeURIComponent(ref)}`;
  }
  return url;
}

/**
 * Fetch a file's contents from the GitHub contents API.
 *
 * @param {object} options
 * @param {string} options.owner Repository owner.
 * @param {string} options.repo Repository name.
 * @param {string} options.path Path to the file within the repository.
 * @param {string} [options.ref] Branch, tag or commit SHA. Defaults to the default branch.
 * @param {string} [options.token] GitHub token. Falls back to GITHUB_TOKEN env var.
 * @param {Function} [options.fetchImpl] Fetch implementation (for testing).
 * @returns {Promise<{content: string, sha: string, ref: string|null, path: string}>}
 */
async function fetchFileContents(options) {
  const { owner, repo, path } = options || {};
  if (!owner || !repo) {
    throw new Error('owner and repo are required');
  }
  if (!path) {
    throw new Error('path is required');
  }

  const ref = validateRef(options.ref);
  const token = options.token || process.env.GITHUB_TOKEN || null;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available');
  }

  const url = buildContentsUrl({ owner, repo, path, ref });
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'manifest-scanner',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    // Never retry automatically; rate-limit errors are surfaced to the caller.
    redirect: 'follow',
  });

  const status = response.status;
  const responseHeaders = response.headers;

  if (isRateLimited(status, responseHeaders)) {
    const { resetTime, retryAfter } = parseRateLimitHeaders(responseHeaders);
    let message = null;
    try {
      const body = await response.json();
      message = body && body.message ? body.message : null;
    } catch (_err) {
      message = null;
    }
    throw new GitHubRateLimitError({
      resetTime,
      retryAfter,
      status,
      message,
    });
  }

  if (!response.ok) {
    let message = `GitHub API request failed with status ${status}`;
    try {
      const body = await response.json();
      if (body && body.message) {
        message = `GitHub API request failed with status ${status}: ${body.message}`;
      }
    } catch (_err) {
      // Ignore body parse errors.
    }
    const error = new Error(message);
    error.status = status;
    error.code = 'GITHUB_REQUEST_FAILED';
    throw error;
  }

  const body = await response.json();

  if (Array.isArray(body)) {
    throw new Error(`Expected a file at "${path}" but found a directory`);
  }

  const encoding = body.encoding || 'base64';
  const rawContent = body.content || '';
  let content;
  if (encoding === 'base64') {
    content = Buffer.from(rawContent, 'base64').toString('utf8');
  } else {
    content = rawContent;
  }

  return {
    content,
    sha: body.sha || null,
    ref,
    path,
  };
}

module.exports = {
  GITHUB_API_BASE,
  MAX_REF_LENGTH,
  InvalidRefError,
  GitHubRateLimitError,
  validateRef,
  parseRateLimitHeaders,
  isRateLimited,
  buildContentsUrl,
  fetchFileContents,
};