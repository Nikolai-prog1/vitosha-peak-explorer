# Vitosha Peak Explorer

A static-first 3D hiking explorer for Vitosha Mountain, adapted from the Pirin Peak Explorer interaction and visual system. The production foundation is implemented; the full release/investor-readiness checklist remains in `docs/release-plan.md`. Do not present this as a finished commercial or safety-navigation product yet.

## Features

- Cesium ion aerial imagery and 3D World Terrain at true 1× height scale; only Vitosha summit labels appear on the map
- Terrain vertex normals, consistent stylized daylight and finer screen-space tile detail
- Panel-aware summit/route framing that preserves normal picking and stops auto-framing on a manual map gesture
- 17 high Vitosha summits with OSM coordinates and elevations
- 16 huts and shelters
- Three approach previews per summit, using BRouter/OSM where routable
- Search, height/A–Z sorting, summit fly-to, route focus and show-all modes
- Expandable model summit forecast, with deadlines, caching and truthful stale-state handling
- Device-local fallen-tree trail reports
- Paired Bulgarian/English UI and place names
- Saved approach plans, shareable summit/route links, modelled elevation profiles and explicit endpoint-gap warnings
- Validated device-local plans and notes, soft-resolved note history, JSON backup/import and guarded recovery
- GPX 1.1 planning export for routed approaches only, with a visible download link and copy fallback
- Opt-in offline interface/fonts/public planning facts, with verified complete packs, source dates and explicit reconnection
- Responsive desktop and mobile layouts
- Keyboard skip links, native modal background isolation, visible focus and focus-preserving panel controls
- Explicit WGS84 coordinate entry for personal notes, including when 3D is unavailable; no location is assumed
- Pirin Mist interface faithfully adapted for Vitosha

## Run locally

```powershell
npm ci
npm run dev
```

Use Node 24.18.0 (see `.node-version`; supported minimum 22.12). Python 3.12+ is used by the data tools and the XML-contract test. Python's source preview still works after `npm ci` has prepared local browser assets:

```powershell
python -m http.server 4174 --bind 127.0.0.1
```

Open `http://127.0.0.1:4174/` for Python or the address printed by Vite. Static/source previews use the free forecast endpoint for non-commercial evaluation only; they are not the production host.

To inspect the built app with its same-origin forecast proxy:

```powershell
npm run build
npm start
```

Open `http://127.0.0.1:4175/`. Without `.env`, this is explicitly an evaluation instance, bound only to loopback. `npm start` does not build automatically. Production configuration, HTTPS, deployment and rollback are documented in `docs/deployment-runbook.md`.

The compiled client requires complete runtime configuration. If it is missing or malformed, public planning data remains available, but the map and forecast stay disabled with an explicit reload control. It never substitutes the source preview's demo token or direct evaluation forecast. The offline worker's token-free bootstrap is a separate, intentional planning-only state.

## Checks

```powershell
npm run check:data
npm test
npm run build
npm run smoke:release
npm audit --audit-level=high
```

## Data and safety

Peak and hut metadata is generated from cached OpenStreetMap Overpass captures in `work/`. The current generated dataset has 29 modelled BRouter/OSM approach lines and 22 approximate geometric sketches. The UI distinguishes them, shows endpoint gaps, and describes the three candidates as selected by proximity, not popularity or safety. Approximate sketches are dashed and have neither invented height samples nor GPX export. The 29 profiles use cached BRouter elevations; ascent/descent are unfiltered sums and may include model noise. None is a recorded or field-verified track.

Ordinary data regeneration is offline and requires the cached captures. Network route refresh happens only with the explicit `--refresh-routes` option. Source timestamps and remaining data limitations are recorded in generated `public/data/data-quality.json`.

The app is planning context only. It does not provide turn-by-turn navigation, live trail verification, emergency guidance, or shared community reporting. Plans and fallen-tree notes stay in this browser's local storage. Notes are reachable from the personal library: click/tap the loaded map, or use **Note at coordinates** to explicitly enter latitude and longitude around Vitosha in WGS84. The numeric fields start blank, reject missing/swapped/out-of-area input and work without a renderer; they neither infer an incident location nor verify it. The versioned workspace validates imported fields and preserves the old report key; corrupt storage is not silently overwritten. Exports are generated on the device, with no upload of personal notes. Save a private JSON backup before clearing browser data. A share link contains only public summit/route IDs and language; localhost links do not give other people access to the app.

File dialogs retain their download link until closed and offer a selectable/copyable UTF-8 fallback. A successful export preparation is not proof that a browser completed a download. Native Blob downloads have not yet been independently captured in the Codex in-app browser; content/copy/import round-trips are verified, and cross-browser file-download QA remains a release gate.

The supplied Cesium ion token is a browser token, not a secret. Production requires an explicit token with appropriate asset scope and production-URL restrictions. Cesium ion/Bing imagery rights and commercial weather entitlements are external release gates; a successful local map or test does not establish them. Commercial Open-Meteo keys are server-only. No accounts, payments or shared reporting have been introduced.

JavaScript, Cesium workers, icons and fonts are pinned and bundled locally; the map's imagery/terrain and forecast still require their remote providers. Generated provider/library licenses are retained under `dist/vendor/`.

## Offline planning, not offline navigation

In the built app over HTTPS or localhost, use **Prepare offline facts** in the details panel before leaving the connection. The action installs a bounded service worker pack containing the interface, fonts and four public datasets, not satellite imagery, terrain, the Cesium executable, runtime credentials, forecasts, APIs or personal notes. Current packs have 11 files and about 0.6 MiB. Each complete response is size/hash-checked; readiness is recorded only after every required file is stored. Failed installation, quota errors or missing cached resources must not claim readiness. A refresh checks the current release and can repair an evicted current pack when connected. An older complete pack remains available after a failed newer installation.

On an offline launch, search, summit/approach facts, modelled profiles, saved plans, local note reading and client-side exports remain available. Map-only controls and map-picked note placement require the loaded 3D map; explicit coordinate entry does not. Forecast numbers are not presented as current while offline. The reconnect button reloads with fresh, network-only operator configuration; provider tiles/forecasts are never archived by this worker. Pack preparation time and OSM capture dates are shown separately, neither claiming a field inspection.

The browser can evict this public cache or erase private local storage, so keep an independent private JSON backup. Readiness is a checked local state, not a promise of permanent storage. Rendered desktop/mobile app-host outage, cached reload, failed refresh, release update and reconnection are verified locally; full airplane-mode, device/browser eviction and cross-browser QA remain release gates. The Python source preview intentionally does not advertise an installable offline pack.

The current relief uses World Terrain vertex normals, a fixed directional light and a screen-space error target of 1.25. This improves shading and tile refinement, not the source elevation resolution or accuracy. The light is a visual presentation choice, not the current position of the sun or a weather simulation. Geometry is not exaggerated. Camera framing uses the actual visible space between panels and includes route lines plus their hut/summit markers. Modelled route heights (or camera-only endpoint interpolation for sketches) help framing; they are not sampled live terrain or navigation elevations. Translating the camera instead of offsetting its frustum keeps Cesium's ordinary pick/zoom rays aligned with the rendered view. Manual drag, wheel or pinch stops automatic reframing; a fresh explicit focus action enables it again.

The updated product objective allows Cesium or Mapbox. A separate temporary Mapbox GL JS / Terrain-DEM view was rendered with the same public Vitosha approach and 1× heights; it is not integrated into the application and no provider has been declared more accurate or commercially cleared. The comparison and remaining source/device checks are in `docs/market-and-provider-review.md` and R15 of the release plan.

## Key files

- `index.html` — browser entry point
- `src/app.js` — versioned browser entry
- `src/explorer-app.js` — active state, navigation and integration
- `src/styles.css` — complete visual system and responsive layout
- `src/atlas.css` — Pirin Mist theme and Cesium marker styling
- `src/cesium-map.js` — Cesium ion imagery, terrain, markers, routes, and camera controls
- `src/map-framing.js` — unobstructed viewport, perspective camera fit and gesture-aware framing scheduler
- `src/weather.js` — Open-Meteo forecast data adapter
- `src/weather-ui.js` — localized forecast states and tables
- `src/planning.js` / `src/planning-ui.js` — approach facts, profiles, links and GPX
- `src/local-workspace.js` — strict schemas, legacy migration, conflict guards and backup merge
- `src/file-export-ui.js` — client-only file preparation, persistent download link and copy fallback
- `src/focus-management.js` — native modal lifecycle, dynamic keyboard focus order and safe restoration
- `src/i18n.js` — paired owned-interface translations and locale formatting
- `src/explorer-data.js` — bounded loading and runtime data contract
- `src/offline-worker.js` / `src/offline.js` / `src/offline-ui.js` — scoped public pack, verified preparation/recovery and bilingual status
- `server/` — built-artifact host, public config, health and forecast proxy
- `scripts/prepare_assets.mjs` — local, engine-only Cesium and browser dependency generation
- `scripts/check_release.mjs` — compression and release checksums
- `scripts/prepare_offline.mjs` — deterministic, bounded build-time offline catalog and worker generation
- `tests/` — route stability, data, focus lifecycle, coordinate entry, contrast palettes, offline, forecast and HTTP regression tests
- `public/data/` — generated GeoJSON/JSON
- `scripts/build_vitosha_data.py` — data and route builder
- `scripts/validate_data.py` — integrity checks
- `docs/product-plan.md` — implemented scope and boundaries
- `docs/release-plan.md` — full objective, traceability and remaining work
- `docs/deployment-runbook.md` — build, host, HTTPS and rollback instructions
- `docs/qa/` — reference and implementation screenshots used for fidelity review
