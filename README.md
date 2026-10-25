# DependencyLens Backend

HTTP API and GitHub/npm scanner for DependencyLens: see the open-source projects behind a JavaScript application and prepare a funding shortlist.

Version 0.2.0. Independent of Drips; no affiliation or funding guarantee.

This repository is one of three:

- **stellar-dependencies-backend** (this repo): API and scanner
- **stellar-dependencies-frontend**: web UI
- **stellar-dependencies-contract**: optional Solidity `ShortlistRegistry`

Earlier versions served the web UI from this server on one origin. The UI now lives in its own repository.

## Quick start

Install Node.js 22 or newer, then run:

```sh
npm start
```

There are no third-party runtime dependencies, so no `npm install` is needed. The server reads `HOST` and `PORT` (see `.env.example`).

Optional configuration: copy `.env.example` to `.env` (Windows PowerShell: `Copy-Item .env.example .env`; macOS/Linux: `cp .env.example .env`). A server-side `GITHUB_TOKEN` can increase API access capacity; use a token limited to public repository reads. Never commit it.

Tunable limits (all validated at startup; the server exits with an error on invalid values):

- `LOG_LEVEL`: minimum log level, one of `debug`, `info`, `warn`, `error` (default `info`).
- `REQUEST_TIMEOUT_MS`: per-request timeout in milliseconds (default `10000`).
- `MAX_RESPONSE_BYTES`: maximum accepted response size in bytes (default `5242880`).
- `LOOKUP_CONCURRENCY`: number of concurrent npm lookups (default `6`).

```sh
npm run dev     # Watch server files
npm test        # Unit and HTTP integration tests
npm run check   # JavaScript syntax checks
```

## Included features

- GitHub public repository validation and manifest retrieval.
- Optional relative manifest path, such as packages/web/package.json.
- Optional `ref` parameter to scan a specific branch, tag or commit instead of the default branch.
- Automatic workspace traversal: when the root `package.json` declares `workspaces`, their manifests are discovered and scanned too.
- Direct runtime and optional dependencies; development dependencies opt in.
- Configurable concurrent npm lookups, individual lookup failure reporting, request timeouts and response size limits.
- Structured JSON request logs (request id, method, path, status, duration) with tokens and `Authorization` headers redacted.
- Publisher-reported GitHub repository mapping, latest version, license, and npm maintainer usernames in the JSON report.
- Structured reason codes for unsupported dependency specifications.
- Actionable errors when the GitHub API rate limit is hit.
- Node HTTP server, automated tests, Dockerfile, MIT license, contribution and security guidance. Report vulnerabilities through the private channel described in `SECURITY.md`.
- `GET /healthz` liveness endpoint: returns `200` with a small JSON body, makes no upstream calls and is exempt from rate limiting. Suitable for a Docker `HEALTHCHECK` or Kubernetes liveness/readiness probes; see `docs/DEPLOYMENT.md`.

## Scanning a specific ref

By default manifests are fetched from the repository's default branch. Pass an optional `ref` (branch, tag or commit SHA) to scan a different revision:

```sh
curl "http://localhost:3000/api/scan?repo=owner/name&ref=v1.2.0"
```

Refs are validated before any request is made: only letters, digits, `.`, `_`, `-` and `/` are allowed, and the length is capped. Refs that fail validation are rejected with a clear error. When `ref` is omitted, the default branch is used.

## Workspace traversal

If the scanned manifest is the root `package.json` and it declares `workspaces`, DependencyLens resolves those globs (array or `{ "packages": [...] }` form) and scans each matching `package.json` as well. Globs are resolved safely within the repository: paths that escape the repository root are ignored. The number of workspace manifests is capped, and dependencies are aggregated and deduplicated across all scanned manifests, so a package listed by several workspaces appears once in the report.

## Unsupported dependency reason codes

Dependency specifications that cannot be resolved to an npm package are reported as unsupported, each with a machine-readable `reason` code in the JSON report:

| Code | Meaning |
| --- | --- |
| `npm_alias` | npm alias spec, e.g. `npm:other-package@^1.0.0` |
| `workspace_link` | Workspace protocol link, e.g. `workspace:*` |
| `local_path` | Local file or directory path, e.g. `file:../lib` |
| `git_dependency` | Git URL or shorthand, e.g. `github:owner/repo` |
| `unknown` | Any other specification that could not be classified |

## GitHub rate limits

Unauthenticated GitHub API requests hit rate limits quickly. When GitHub responds with `403` or `429` and rate-limit headers, DependencyLens returns an error that includes the reset time and reminds you to set `GITHUB_TOKEN`. Requests are not retried automatically, so a rate-limited scan fails fast instead of causing a retry storm. Set a server-side `GITHUB_TOKEN` (limited to public repository reads) to raise the limit.

## Project structure

- `src/`: HTTP API, GitHub/npm scanner and validation.
- `test/`: scanner and HTTP tests.
- `docs/`: architecture, roadmap, Drips workflow and deployment.

## What this version does not do

It does not resolve installed versions from lockfiles, scan transitive dependencies or peer dependencies, verify repository ownership, calculate funding need, check Drips claim status, create Drip Lists, connect wallets or send funds. npm aliases, workspace links, local paths and Git dependency specifications are marked unsupported and carry a reason code (see above). Unknown metadata stays unknown; no funding statistics are fabricated.

Metadata comes from each package's **latest** npm release, which may differ from the version your application uses. A repository URL is a lead to review, not proof of ownership. Review licenses and project identities before supporting a repository.

The app has no database, login, persisted reports or background jobs. Public deployment requires the controls described in `docs/DEPLOYMENT.md`.

## Deploying the API

The API runs as a standalone service; the web UI is hosted separately from its own repository. Operators deploying the API should follow `docs/DEPLOYMENT.md`, which covers Docker and standalone deployment, environment variables, CORS origins for the frontend, reverse-proxy settings, TLS and rate limits. The frontend repository's hosting notes describe how to point the UI at this API.

## Reference documentation

- GitHub contents API: https://docs.github.com/en/rest/repos/contents
- npm metadata: https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md
- Drips concepts: https://docs.drips.network/
- Drips claim flow: https://docs.drips.network/get-support/claim-your-repository/
