# Vitosha Peak Explorer

Static, local-first 3D GIS web application. `index.html` loads the active browser-ESM implementation from `src/app.js`; `src/styles.css` contains the shared visual system. The map renderer is CesiumJS with Cesium ion aerial imagery and World Terrain; `src/cesium-map.js` adapts camera, marker, and route interactions. Local GeoJSON lives under `public/data`.

## Commands

- Local server without Node: `python -m http.server 4174`
- Install/build: `npm install`, then `npm run build`
- Validate data: `python scripts/validate_data.py`
- Regenerate data from cached Overpass captures: `python scripts/build_vitosha_data.py`
- Refresh route geometry too: `python scripts/build_vitosha_data.py --refresh-routes`

## Invariants

- Keep GeoJSON coordinates in `[longitude, latitude]` order.
- Keep peak/hut IDs stable and keep route cross-references valid.
- Keep bilingual Bulgarian/English UI and place names.
- The supplied Cesium ion access token is used in the browser for aerial imagery and World Terrain; do not add secret tokens.
- Keep the base imagery free of city and road labels; map labels should identify Vitosha peaks only.
- Trail reports remain device-local. Do not imply synchronization, moderation, or live safety validation.
- Route previews are informational planning context, never turn-by-turn or safety navigation.
- `public/data` is generated; change the builder or cached inputs, then regenerate.
- Preserve the recognizable Pirin Peak Explorer panel skeleton and interaction model.

## Verification

Run the data validator and production build, then verify the real rendered app on desktop and a narrow/mobile viewport. Check map load, summit selection, search/sort, route visibility, panel collapse, and the fallen-tree report flow.
