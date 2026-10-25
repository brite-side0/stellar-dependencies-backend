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
=======

```sh
npm run dev     # Watch server files
npm test        # Unit and HTTP integration tests
npm run check   # JavaScript syntax checks
```

## Included features

- GitHub public repository validation and default-branch manifest retrieval.
- Optional relative manifest path, such as packages/web/package.json.
- Direct runtime and optional dependencies; development dependencies opt in.
- Configurable concurrent npm lookups, individual lookup failure reporting, request timeouts and response size limits.
- Structured JSON request logs (request id, method, path, status, duration) with tokens and `Authorization` headers redacted.
- Publisher-reported GitHub repository mapping, latest version, license, and npm maintainer usernames in the JSON report.
- Node HTTP server, automated tests, Dockerfile, MIT license, contribution and security guidance. Report vulnerabilities through the private channel described in `SECURITY.md`.

## Project structure

- `src/`: HTTP API, GitHub/npm scanner and validation.
- `test/`: scanner and HTTP tests.
- `docs/`: architecture, roadmap, Drips workflow and deployment.

## What this version does not do

It does not resolve installed versions from lockfiles, scan transitive dependencies or peer dependencies, traverse workspaces automatically, verify repository ownership, calculate funding need, check Drips claim status, create Drip Lists, connect wallets or send funds. npm aliases, workspace links, local paths and Git dependency specifications are marked unsupported. Unknown metadata stays unknown; no funding statistics are fabricated.

Metadata comes from each package's **latest** npm release, which may differ from the version your application uses. A repository URL is a lead to review, not proof of ownership. Review licenses and project identities before supporting a repository.

The app has no database, login, persisted reports or background jobs. Public deployment requires the controls described in `docs/DEPLOYMENT.md`.

## Deploying the API

The API runs as a standalone service; the web UI is hosted separately from its own repository. Operators deploying the API should follow `docs/DEPLOYMENT.md`, which covers Docker and standalone deployment, environment variables, CORS origins for the frontend, reverse-proxy settings, TLS and rate limits. The frontend repository's hosting notes describe how to point the UI at this API.

## Reference documentation

- GitHub contents API: https://docs.github.com/en/rest/repos/contents
- npm metadata: https://github.com/npm/registry/blob/main/docs/responses/package-metadata.md
- Drips concepts: https://docs.drips.network/
- Drips claim flow: https://docs.drips.network/get-support/claim-your-repository/
