'use strict';

/**
 * Structured reason codes for unsupported dependency specs.
 *
 * Every unsupported dependency reported by the scanner carries exactly one
 * of these machine-readable codes so that consumers of the report JSON can
 * react programmatically instead of parsing human-readable messages.
 *
 * - `npm_alias`       : spec uses the `npm:` protocol (e.g. `npm:foo@^1.0.0`).
 * - `workspace_link`  : spec uses the `workspace:` protocol (e.g. `workspace:*`).
 * - `local_path`      : spec points at a local file or directory
 *                       (e.g. `file:../pkg`, `link:./pkg`, `./pkg`, `/abs/pkg`).
 * - `git_dependency`  : spec points at a Git repository
 *                       (e.g. `git+https://...`, `github:user/repo`, `user/repo`).
 * - `unknown`         : spec is unsupported but does not match any known form.
 *
 * @readonly
 * @enum {string}
 */
const ReasonCode = Object.freeze({
  NPM_ALIAS: 'npm_alias',
  WORKSPACE_LINK: 'workspace_link',
  LOCAL_PATH: 'local_path',
  GIT_DEPENDENCY: 'git_dependency',
  UNKNOWN: 'unknown',
});

/**
 * All reason codes as an array, in a stable order.
 * @type {string[]}
 */
const REASON_CODES = Object.freeze([
  ReasonCode.NPM_ALIAS,
  ReasonCode.WORKSPACE_LINK,
  ReasonCode.LOCAL_PATH,
  ReasonCode.GIT_DEPENDENCY,
  ReasonCode.UNKNOWN,
]);

/**
 * Human-readable documentation for each reason code.
 * @type {Readonly<Record<string, string>>}
 */
const REASON_DESCRIPTIONS = Object.freeze({
  [ReasonCode.NPM_ALIAS]:
    'Dependency uses the npm: alias protocol and cannot be resolved as a plain registry spec.',
  [ReasonCode.WORKSPACE_LINK]:
    'Dependency uses the workspace: protocol and refers to a package inside the workspace.',
  [ReasonCode.LOCAL_PATH]:
    'Dependency refers to a local file or directory via file:, link:, or a relative/absolute path.',
  [ReasonCode.GIT_DEPENDENCY]:
    'Dependency refers to a Git repository via a git+ URL, a host shorthand, or a user/repo spec.',
  [ReasonCode.UNKNOWN]:
    'Dependency spec is unsupported but does not match any known unsupported form.',
});

const NPM_ALIAS_RE = /^npm:/i;
const WORKSPACE_LINK_RE = /^workspace:/i;
const LOCAL_PATH_RE = /^(file:|link:|\.{1,2}(?:[/\\]|$)|[/\\]|~[/\\])/i;
const GIT_PROTOCOL_RE = /^git(?:\+[a-z0-9]+)?:/i;
const GIT_HOST_SHORTHAND_RE =
  /^(?:github|gitlab|bitbucket|gist):/i;
const GIT_URL_RE = /^(?:https?|ssh|git):\/\//i;
const GIT_SSH_RE = /^[^@\s]+@[^:\s]+:/;
const GIT_USER_REPO_RE =
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#.*)?$/;

/**
 * Determine whether a spec looks like a Git dependency.
 * @param {string} spec
 * @returns {boolean}
 */
function isGitSpec(spec) {
  if (GIT_PROTOCOL_RE.test(spec)) return true;
  if (GIT_HOST_SHORTHAND_RE.test(spec)) return true;
  if (GIT_SSH_RE.test(spec)) return true;
  if (GIT_URL_RE.test(spec)) {
    // Plain http(s)/ssh URLs are only treated as Git when they carry a
    // Git-ish marker; otherwise they are not valid registry specs either,
    // but we keep the classification conservative.
    return /\.git(?:#.*)?$/i.test(spec) || /^ssh:/i.test(spec) || /^git:/i.test(spec);
  }
  if (GIT_USER_REPO_RE.test(spec)) return true;
  return false;
}

/**
 * Classify an unsupported dependency spec string into a structured reason code.
 *
 * @param {string} spec The dependency spec (e.g. the value from package.json).
 * @returns {string} One of the {@link ReasonCode} values.
 */
function classifyReason(spec) {
  if (typeof spec !== 'string') return ReasonCode.UNKNOWN;

  const trimmed = spec.trim();
  if (trimmed === '') return ReasonCode.UNKNOWN;

  if (NPM_ALIAS_RE.test(trimmed)) return ReasonCode.NPM_ALIAS;
  if (WORKSPACE_LINK_RE.test(trimmed)) return ReasonCode.WORKSPACE_LINK;
  if (LOCAL_PATH_RE.test(trimmed)) return ReasonCode.LOCAL_PATH;
  if (isGitSpec(trimmed)) return ReasonCode.GIT_DEPENDENCY;

  return ReasonCode.UNKNOWN;
}

/**
 * Get the human-readable description for a reason code.
 * @param {string} code
 * @returns {string}
 */
function describeReason(code) {
  return REASON_DESCRIPTIONS[code] || REASON_DESCRIPTIONS[ReasonCode.UNKNOWN];
}

module.exports = {
  ReasonCode,
  REASON_CODES,
  REASON_DESCRIPTIONS,
  classifyReason,
  describeReason,
};