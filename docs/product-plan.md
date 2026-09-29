# Vitosha Peak Explorer — implemented MVP

## Product thesis

- **Specified:** reproduce the Pirin Peak Explorer experience for Vitosha and use the supplied Mapbox token.
- **Inferred:** the primary users are hikers exploring high Vitosha summits, nearby huts, and approach context on a 3D map.
- **Recommended and implemented:** preserve the original bilingual dark-glass interface, local-first data model, route chooser, and device-local fallen-tree reports.

## Scope

The MVP contains 17 high Vitosha summits, 16 huts or shelters, three route candidates per summit, Mapbox satellite streets with 3D terrain, search and sorting, route focus/show-all controls, responsive collapsible panels, and local trail reports.

Authentication, shared reporting, moderation, weather, offline tile packaging, and turn-by-turn navigation are intentionally excluded.

## Data boundaries

Peak and hut metadata comes from cached OpenStreetMap Overpass exports. Route geometry uses BRouter's hiking profile over OSM where a connected route is available; otherwise the UI identifies the preview as approximate. Reports are stored only in browser local storage.

## First vertical slice and verification

`summit selection → Mapbox camera → summit details → nearest route candidates → route geometry and hut markers` is the primary slice. Data validation, production build, desktop interaction, and mobile interaction are required completion evidence.
