# Build, operate and roll back a Vitosha release

This runbook covers the implemented static-first client and Node host. It is not evidence that hosting, commercial licenses, operator disclosures or the entire product have been approved. No public deployment or paid service has been provisioned.

## Build and verify on the build machine

Use Node 24.18.0 and Python 3.12 or later. Run from the project directory:

```sh
npm ci
npm run check:data
npm test
npm run build
npm run smoke:release
npm audit --audit-level=high
```

The lockfile pins the application dependencies. Installation/build prepares `public/vendor`; the generator refuses to replace an unrecognized directory. Vite bundles the application; Cesium's engine is separately bundled without the unused Knockout widgets. Workers, CSS, font subsets and upstream licenses ship locally.

The build first generates a deterministic opt-in offline catalog/worker, then Brotli/gzip sidecars and `dist/release-manifest.json` containing client file hashes, selected host/runtime file hashes and a combined content ID. Production startup recomputes both sets and refuses a changed or incomplete artifact. An HTML offline marker additionally requires a complete, bounded catalog matching the worker and each owned cached file. This detects drift; it is not a signed authenticity guarantee. Record the manifest together with the source commit, test output and browser QA evidence. Dependency audits describe known advisories at their run time, not proof that a product has no vulnerabilities.

The smoke check copies only the runtime files to a fresh temporary directory without `node_modules`, imports that isolated host, binds an ephemeral loopback port, validates local assets, health/config/data and denied private paths, then shuts down and removes its fixture. It deliberately uses a non-credential fixture token and disables weather. Real rendering and provider entitlements are separate checks.

`.github/workflows/verify.yml` defines these checks on Windows and Ubuntu and saves a selected runtime artifact. Action versions are pinned to officially verified commits. The workflow does not deploy. It has not been run on GitHub until the repository is pushed and a job result is obtained; local Windows checks are not Linux/hosted-CI evidence.

## Runtime files

Keep one immutable release directory containing:

- `dist/` including sidecars, licenses and the release manifest;
- `server/`;
- `src/config.js`, `src/weather.js`, `src/requests.js` (shared server adapters);
- `scripts/check_release.mjs`;
- `package.json` (for ESM and the optional start command) and `package-lock.json` (release provenance).

The Node host uses only built-in runtime modules. No `node_modules`, dev server, source application bundle, private `.env`, cached OSM capture or test fixture needs to be publicly served. Do not run the asset generator in an immutable runtime directory. Build tooling requires the full installation, including dev dependencies; there is no requirement to install npm packages on the runtime machine.

## Configuration

Create a private `.env` using `.env.example` as the shape. Never commit it or put it under `dist`. Supply:

| Variable | Production requirement |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `127.0.0.1` behind a local reverse proxy |
| `PORT` | Available private port, default `4175` |
| `PUBLIC_ORIGIN` | Approved public HTTPS origin, without a path/query/credentials |
| `CESIUM_ION_TOKEN` | Explicit browser-visible token; restrict assets/production URLs in the provider account |
| `WEATHER_MODE` | `commercial` with a paid entitlement, or `disabled` |
| `OPEN_METEO_API_KEY` | Private server key when mode is `commercial`; otherwise omit |

`evaluation` is intentionally refused in production. Without `.env`, `npm start` is a local non-commercial evaluation instance. The Python/Vite source preview is also evaluation-only. The example configuration contains no private key. Production refuses an unchanged example token and requires an explicit HTTPS origin; it cannot verify the account's contractual entitlement.

The compiled browser client also fails closed when `/runtime-config.js` is absent, malformed, or requests the source-only direct forecast mode: no provider token fallback, Cesium executable request or forecast request is started. Public planning data and device-local plans/notes remain accessible with a configuration-reload notice. Only an explicitly identified source preview can use evaluation defaults. The worker's network-failure bootstrap deliberately contains no provider token and sets offline planning/disabled weather; recovering requires a reload with fresh operator configuration. Check both missing-configuration and offline recovery paths after edge changes, not just host readiness.

Run from the release directory with a service manager, using an unprivileged account and a private environment:

```sh
node --env-file=.env server/index.js
```

Configure restart-on-failure, reasonable memory/process limits and a working directory pointing to that immutable release. Do not bind the Node process publicly just to work around a missing reverse proxy.

## HTTPS and edge requirements

An operator must approve the domain/hosting first. Terminate TLS with a maintained reverse proxy and valid certificate. Redirect public HTTP to HTTPS, preserve the approved Host header, forward only the intended app paths, keep the upstream private, and apply connection/response deadlines and per-client weather rate limits at the edge. Do not replace the application's CSP with a weaker one.

The app rejects unrecognized Host values, dotfiles/traversal/Windows stream paths, directory listings, unsupported file types, request bodies and write methods. Static HTML, `offline-worker.js` and `offline-pack.json` are revalidated, not immutable; hashed Vite assets are immutable; runtime configuration/API results are `no-store`. Preserve these policies at the edge, including the worker's JavaScript MIME type. Compression varies on `Accept-Encoding`.

The CSP permits local executable code, local/blob workers and WebAssembly compilation, not JavaScript string evaluation. It allows the required Cesium/Virtual Earth/Bing data and images. `upgrade-insecure-requests` upgrades legacy imagery URLs to HTTPS. Inline styles remain allowed for dynamically positioned markers and React styles. Geolocation, camera and microphone permissions are disabled.

The server never trusts arbitrary forwarded IP headers. Its forecast rate limit counts the upstream socket address, so users behind one proxy share that limiter. The edge must enforce the real per-client limit; choose the app limit and instance count accordingly before load testing. Do not simply trust `X-Forwarded-For` from the Internet.

Health is `GET /api/health`: ready flag, release ID, uptime, summit count and weather mode; it exposes neither keys nor provider URLs. In production the ID is the first 16 characters of the verified manifest content ID; a local evaluation host instead reports the startup HTML hash, not a verified artifact ID. Use this for readiness and compare the production release ID with the expected artifact. Provider health must be measured separately: readiness does not assert that every tile or current forecast is available.

## Forecast constraints

Only registered summit IDs are accepted. Coordinates, fixed provider endpoints and paid keys are controlled server-side; this is not an arbitrary URL proxy. There are complete-body deadlines, size limits, a 15-minute cache, shared in-flight requests, four concurrent upstream requests, short failure backoff and at most one hour of explicitly marked stale fallback. API failures are sanitized. The cache is memory-only; restarting loses it, and multiple instances do not share it.

Monitor aggregate status/latency/error rates and capacity without logging keys, upstream query strings or user trail notes. Reverse-proxy access logs may contain client IPs; their retention and privacy notice are the operator's responsibility. The current application adds no analytics and stores reports only on the device, but remote map/forecast providers receive network requests.

## Release and rollback

The opt-in worker requires HTTPS (loopback is supported) and the application at the origin root. Do not silently deploy this root-scoped implementation into a subpath or an origin shared with another root service worker. Preparation refuses to replace an unrelated worker. Only whitelisted public facts/interface/fonts are retained; runtime configuration always goes to the network and falls back to a token-free offline-launch/disabled-forecast configuration. A complete cached pack can launch planning after an app-host outage, not 3D or safety navigation. Keep private workspaces out of this cache.

1. Preserve the current release directory and its manifest. Prepare a separate new directory; never edit files under the running release.
2. Run the documented checks. Start the new release on a different private port. Confirm its health/content ID and test real desktop/narrow map load, summit selection, search/sort, routes, weather, panel collapse and failure/retry states.
3. After publication authority and external gates are satisfied, switch the reverse proxy atomically to the verified new process. Monitor readiness and provider/error rates.
4. Keep the previous process/artifact during observation. On regression, switch the edge back to that known release and verify its health ID. Do not rebuild a previous version during an incident.
5. Send SIGTERM to a process being retired. It drains active bounded requests, closes idle connections and force-closes remaining connections after 15 seconds. Use at least 20 seconds of service-manager shutdown grace. On Windows, verify the manager's actual graceful-stop mechanism; a hard task kill is not a graceful signal.

Local trail reports are tied to browser origin. A domain change does not migrate them. Future saved-plan/import/export changes must include compatibility and backup checks before release. There is currently no server-side user database to restore or migrate.

Exercise an already-controlled browser across each upgrade/rollback, not just a fresh tab. Workers retain the current and most recent previous owned public pack and clean only older matching caches; other applications' caches and private storage are untouched. A newer pack waits until complete and is activated by explicit preparation. Online public data/navigation are network-first, while immutable app assets/fonts are cache-first. An old rollback artifact without an offline marker remains supported by release inspection; existing clients can still retain their previously prepared offline snapshot during an outage. Never describe that snapshot as the rollback's current live release. Do not erase browser data to resolve a release incident: private plans/notes need independent backups. True network loss, storage eviction/quota, real device and browser upgrade/rollback journeys require release QA; the local outage tests are not proof of permanent offline storage.

## External gates still open

Confirm Cesium ion/Bing imagery production/commercial rights, weather entitlement or intentional forecast disablement, domain/operator/privacy/contact details, branding rights, hosted CI and browser/device/load evidence, data freshness and all remaining rows of `release-plan.md`. An acquisition/investment presentation must distinguish implemented checks from these unverified gates and from real user/market evidence.
