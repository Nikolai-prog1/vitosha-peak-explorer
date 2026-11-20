# Vitosha Peak Explorer

Static-first, local-first 3D GIS web application. `index.html` loads the active browser-ESM implementation from `src/app.js`; `src/styles.css` and `src/atlas.css` contain the shared visual system. The map renderer is the pinned, locally bundled CesiumJS engine with Cesium ion aerial imagery and World Terrain; `src/cesium-map.js` adapts camera, marker, and route interactions. Local GeoJSON lives under `public/data`. The optional Node host in `server/` serves only `dist/`, public runtime configuration and a bounded forecast proxy; it does not store user reports or identities.

`src/app.js` is a thin entry for `src/explorer-app.js`. Planning, translations and validated device storage live in `planning.js`, `i18n.js` and `local-workspace.js`; `planning-ui.js`, `file-export-ui.js` and `weather-ui.js` contain the corresponding UI. `docs/release-plan.md` is the complete release/investor-readiness checklist, not an MVP completion shortcut.

`focus-management.js` owns native modal activation, dynamic keyboard edges and focus restoration. The mobile chooser is a native dialog; desktop panels remain ordinary regions. Equivalent panel/library controls keep redundant map markers out of the Tab sequence.

Offline planning is opt-in in the built app. `scripts/prepare_offline.mjs` generates the checked catalog and root worker from `src/offline-worker.js`; `offline.js` and `offline-ui.js` manage explicit preparation, release updates and truthful local readiness.

The updated user objective permits Cesium ion or Mapbox when it improves Vitosha's practical 3D experience. Cesium remains the active implementation; evaluate source resolution, imagery, shading, camera framing and device performance separately before switching providers. `src/map-framing.js` fits points into the actual unobstructed panel layout using a translated camera, not off-centre frustum offsets that break the pinned SDK's picking rays.

## Commands

- Install reproducibly: `npm ci` (Node version in `.node-version`)
- Development: `npm run dev`
- Python static preview after assets have been prepared by installation: `python -m http.server 4174 --bind 127.0.0.1`
- Build and audit release artifact: `npm run build`
- Node host for the built artifact: `npm start` (loopback 4175 by default)
- Unit and HTTP integration tests: `npm test`
- Production-host smoke without contacting providers: `npm run smoke:release`
- Validate data: `python scripts/validate_data.py`
- Regenerate data from cached Overpass captures: `python scripts/build_vitosha_data.py`
- Refresh route geometry too: `python scripts/build_vitosha_data.py --refresh-routes`
- Refresh the hut tags, marked hiking relations and Vitosha Nature Park boundary: `python scripts/fetch_osm_captures.py --huts --routes --park`
- Select the Geofabrik Bulgaria fallback explicitly: `python scripts/fetch_osm_captures.py --source geofabrik --huts --routes --park`

## Invariants

- Keep GeoJSON coordinates in `[longitude, latitude]` order.
- Keep peak/hut IDs stable and keep route cross-references valid.
- Keep bilingual Bulgarian/English UI and place names.
- The supplied Cesium ion access token is used in the browser for aerial imagery and World Terrain; do not add secret tokens.
- Private commercial forecast keys stay on the server. Production must not silently use the free evaluation endpoint.
- Compiled clients fail closed on missing/malformed runtime configuration. Evaluation defaults belong only to the explicitly identified source preview; the offline bootstrap must stay token-free and planning-only.
- Do not add `unsafe-eval` to the production CSP. Bundle the engine-only runtime from `src/cesium-runtime.js`; do not patch upstream SDK files.
- `public/vendor` is generated from the pinned npm dependencies. Edit the generator, not generated files.
- Preserve source-preview cache-version URLs when changing previously served modules. Production application files use Vite content hashes; Python previews need explicit version changes for updated source modules/styles.
- Keep the base imagery free of city and road labels; map labels should identify Vitosha peaks only.
- Huts are always shown as unlabelled icon markers by default. The panel hut list is their keyboard equivalent.
- Each summit lists exactly three approaches from its nearest open trailheads; huts within 200 m share one trailhead. Every other open hut gets one `hut-nearest-summit` approach, shown in the summit panel only while it is the chosen route. A closed hut needs a sourced manual `status` and never starts an approach. Use `--missing-routes` to route new pairs without refreshing cached lines.
- Marked trails are informational OSM route relations. They never rank or select approaches. Keep relations with at least 2 km and 25% of their length inside the OSM nature park. Use standard-library Python to clip the drawn paths to the park plus 300 m.
- Hut details carry a per-field source (OSM or manual) and are never invented. Maintain manual records in `work/hut-details.curated.json`; a manual value fills an OSM gap, it does not overwrite a conflicting OSM value without a check. Every manual record names its source (`ref`, described under `sources`), and the UI shows that source, not a generic "manual" tag. OSM tags every listed lodge as `alpine_hut`; a facility kind other than hut or shelter (`lodge` for a tourist-society house) is a sourced manual `kind`. Do not label hotels or lodges as huts.
- Never regenerate data without the committed BRouter cache or `--refresh-routes`.
- Keep true 1× terrain height scale. Normals, stylized directional daylight and finer screen-space tile detail are presentation/refinement, not proof of higher source resolution or live sunlight.
- Include the real hut and summit markers when framing a route; a route's endpoint gaps must not hide them. Stop layout auto-framing after native map gestures until the next explicit focus action.
- Trail reports remain device-local. Do not imply synchronization, moderation, or live safety validation.
- Preserve both map-picked and explicitly entered WGS84 note locations. Coordinate fields start blank, share the validated workspace bounds, and do not require 3D or infer a fallen-tree location. Imported coordinates remain numeric; manual string input is normalized before storage.
- Native dialogs must make the background actually inert, contain Tab/Shift+Tab, close on Escape, and restore a connected focusable trigger or logical fallback. Dynamic note resolution must not leave focus on the body.
- The offline worker caches only whitelisted owned interface/fonts/public facts. Never archive provider tiles, terrain, forecasts, runtime tokens, APIs or private workspaces. Keep network/body deadlines, complete-pack integrity, eviction/repair checks and an explicit reconnect; offline facts are not navigation.
- Preserve legacy report storage on migration. Never overwrite invalid local data or silently replace newer entries in another tab. Recovery keeps a separate original copy.
- GPX is available only for routed approaches. Approximate sketches have no invented elevation profile or GPX track. File exports are client-only and must not claim a download completed just because a link was clicked.
- Route previews are informational planning context, never turn-by-turn or safety navigation.
- `public/data` is generated; change the builder or cached inputs, then regenerate.
- Explorer v2 layout (`src/explorer-v2.css`): full-bleed map, top search combobox, one task-ordered panel (summit → approaches → plan → weather → library → data) that becomes a three-height bottom sheet on phones. Overlay panels carry `data-map-occluder` so camera framing avoids them.
- Explorer v2 overview switches between summit and hut lists. Its legend controls the hut layer and has an unchecked, session-only option for all marked trails. With that option off, show qualifying markings only for the selected approach or open hut card; a selected summit alone shows none. Hut and trail details use a map-anchored card on desktop and the existing bottom sheet on mobile. Include the legend in framing and keep the trail geometry in one ground primitive below the approach entities.

## Verification

Run the data validator, tests, production build and production-host smoke, then verify the real rendered app on desktop and a narrow/mobile viewport. Check map load, summit selection, search/sort, route visibility, panel collapse, forecast loading, failure/retry states, and the fallen-tree report flow. Test offline preparation/host outage/reload/update/reconnection on a separate origin, preserving main-origin personal state. Preserve route entities across equivalent updates; recreating ground-clamped entities causes flicker. Do not run generated-asset preparation concurrently with module-import tests.

For accessibility changes, exercise skip links, mobile chooser, share/file dialogs, note creation/resolve/cancel and focus restoration with the keyboard. Run axe on each visible state; record incomplete/manual-review results, especially image/translucency/overlap contrast. Palette-bound tests complement but do not replace real screen-reader, reflow/zoom, touch and cross-browser verification; do not claim WCAG conformance from a passing automated scan.
