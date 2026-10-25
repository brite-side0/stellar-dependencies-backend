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

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `3000` | Listen port |
| `GITHUB_TOKEN` | unset | Raises GitHub API capacity (public repository reads only) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window length in milliseconds |
| `RATE_LIMIT_MAX` | `30` | Maximum scan requests per client per window |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for client IPs (see caveat below) |
| `NPM_CACHE_TTL_MS` | `300000` | npm registry metadata cache TTL in milliseconds |
| `NPM_CACHE_MAX_ENTRIES` | `500` | Maximum cached npm packages |

### Rate limiting

Scan endpoints are rate limited in memory per client IP. Clients exceeding the limit receive `429 Too Many Requests` with a `Retry-After` header (seconds until the window resets). Limits are per process; restarting the server resets them.

Client IPs come from the socket address by default. Set `TRUST_PROXY=true` only when the server sits behind a reverse proxy you control that sets `X-Forwarded-For`; otherwise clients can spoof the header and evade the limit.

### npm registry cache

npm registry lookups are cached in memory with a TTL and a bounded entry count (`NPM_CACHE_TTL_MS`, `NPM_CACHE_MAX_ENTRIES`). Repeated scans of the same package within the TTL make no upstream request. Tests can bypass the cache.

```sh
npm run dev     # Watch server files
npm test        # Unit and HTTP integration tests
npm run check   # JavaScript syntax checks
```

## Included features

- GitHub public repository validation and default-branch manifest retrieval.
- Optional relative manifest path, such as packages/web/package.json.
- Direct runtime and optional dependencies; development dependencies opt in.
- Six concurrent npm lookups, individual lookup failure reporting, request timeouts, response size limits.
- Bounded in-memory npm registry cache with configurable TTL and size.
- Per-client rate limiting on scan endpoints with `429` and `Retry-After`.
- Publisher-reported GitHub repository mapping, latest version, license, and npm maintainer usernames in the JSON report.
- Optional installed-version resolution from the repository's `package-lock.json`; the report marks the installed version as `unknown` when no lockfile is found.
- Opt-in transitive dependency scanning with configurable depth and total-package caps; packages are deduplicated and depth is recorded in the report.
- Node HTTP server, automated tests, Dockerfile, MIT license, contribution and security guidance.

## Project structure

- `src/`: HTTP API, GitHub/npm scanner and validation.
- `test/`: scanner and HTTP tests.
- `docs/`: architecture, roadmap, Drips workflow and deployment.

## What this version does not do

It does not scan peer dependencies, traverse workspaces automatically, verify repository ownership, calculate funding need, check Drips claim status, create Drip Lists, connect wallets or send funds. npm aliases, workspace links, local paths and Git dependency specifications are marked unsupported. Unknown metadata stays unknown; no funding statistics are fabricated.

Installed versions are resolved from `package-lock.json` only when present; without a lockfile the report marks the installed version as `unknown`. Transitive dependency scanning is opt-in and bounded by depth and total-package caps.

Metadata comes from each package's **latest** npm release, which may differ from the version your application uses. A repository URL is a lead to review, not proof of ownership. Review licenses and project identities before supporting a repository.

The app has no database, login, persisted reports or background jobs. Public deployment requires the controls described in `docs/DEPLOYMENT.md`.

## Deploying the API

The API runs as a standalone service; the web UI is hosted separately from its own repository. Operators deploying the API should follow `docs/DEPLOYMENT.md`, which covers Docker and standalone deployment, environment variables, CORS origins for the frontend, reverse-proxy settings, TLS and rate limits. The frontend repository's hosting notes describe how to point the UI at this API.

## Reference documentation

- GitHub contents API: https://docs.github.com/en/rest/repos/contents
- npm metadata: https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md
- Drips concepts: https://docs.drips.network/
- Drips claim flow: https://docs.drips.network/get-support/claim-your-repository/
