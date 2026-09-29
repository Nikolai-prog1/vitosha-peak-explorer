# Vitosha Peak Explorer

A bilingual, static 3D hiking explorer for Vitosha Mountain, adapted from the Pirin Peak Explorer interaction and visual system.

## Features

- Cesium ion aerial imagery and 3D World Terrain; only Vitosha summit labels appear on the map
- 17 high Vitosha summits with OSM coordinates and elevations
- 16 huts and shelters
- Three approach previews per summit, using BRouter/OSM where routable
- Search, height/A–Z sorting, summit fly-to, route focus and show-all modes
- Expandable live summit forecast from Open-Meteo
- Device-local fallen-tree trail reports
- Responsive desktop and mobile layouts
- Pirin Mist interface faithfully adapted for Vitosha

## Run locally

```powershell
npm install
npm run dev
```

Or without Node tooling:

```powershell
python -m http.server 4174
```

Open `http://127.0.0.1:4174/`.

## Checks

```powershell
npm run check:data
npm run build
```

## Data and safety

Peak and hut metadata is generated from cached OpenStreetMap Overpass captures in `work/`. Route geometry uses BRouter's hiking profile over OSM where a connected route can be calculated; unavailable paths fall back to a clearly labelled approximate preview.

The app is planning context only. It does not provide turn-by-turn navigation, live trail verification, emergency guidance, or shared community reporting. Fallen-tree reports stay in the current browser's local storage.

The Cesium ion access token supplied for this project is embedded in the browser client. It needs access to Bing Maps Aerial imagery and Cesium World Terrain. Do not add secret tokens to browser code.

## Key files

- `index.html` — browser entry point
- `src/app.js` — active application
- `src/styles.css` — complete visual system and responsive layout
- `src/atlas.css` — Pirin Mist theme and Cesium marker styling
- `src/cesium-map.js` — Cesium ion imagery, terrain, markers, routes, and camera controls
- `src/weather.js` — Open-Meteo forecast data adapter
- `public/data/` — generated GeoJSON/JSON
- `scripts/build_vitosha_data.py` — data and route builder
- `scripts/validate_data.py` — integrity checks
- `docs/product-plan.md` — implemented scope and boundaries
- `docs/qa/` — reference and implementation screenshots used for fidelity review
