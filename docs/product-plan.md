# Vitosha Peak Explorer — product history and current direction

## Product thesis

- **Specified:** reproduce the Pirin Peak Explorer experience for Vitosha; Cesium ion aerial imagery and World Terrain are the current renderer. The updated release objective permits Cesium or Mapbox to prioritize attractive, practical Vitosha 3D relief; neither provider's site-specific accuracy or commercial rights are assumed.
- **Inferred:** the primary users are hikers exploring high Vitosha summits, nearby huts, and approach context on a 3D map.
- **Implemented:** preserve the recognizable panel layout, Pirin Mist visual system, local-first data model, route chooser, and device-local fallen-tree reports.

## Scope

The application contains 17 high Vitosha summits, 16 huts or shelters, three approach candidates per summit, Cesium ion aerial imagery and World Terrain, search/sort, stable route focus/show-all controls, responsive panels and an Open-Meteo summit forecast. It now includes paired Bulgarian/English controls and names, modelled profiles, honest approach provenance/end gaps, saved plans, public-ID share links, guarded GPX export, private JSON backups and validated local notes. The user removed the top fallen-tree launcher; notes are reachable from the local library, not a restored header launcher.

The current broad release/investor objective is tracked in [release-plan.md](release-plan.md). Earlier MVP exclusions do not narrow that objective. Shared reporting and turn-by-turn safety navigation remain outside the explicit architectural invariants; business-model decisions are pending.

## Data boundaries

Peak and hut metadata comes from cached OpenStreetMap Overpass exports. Twenty-nine approach lines use cached BRouter hiking-profile geometry and model heights; 22 are explicitly dashed approximate sketches without profiles or GPX. Endpoint gaps and route type are shown individually. No popularity, difficulty or current safety is invented. Plans and notes use a validated, versioned device-local workspace; old report storage is preserved, and backups are merged explicitly without replacing existing colliding entries.

The production foundation now bundles executable dependencies/fonts locally and adds a Node forecast/configuration/health host. It does not add accounts, shared reporting or a user database. See the release plan for evidence and remaining requirements.

The current map adds panel-aware route/summit framing, preserved native picking, manual-gesture cancellation of auto-framing and true-scale terrain with vertex-normal daylight shading. Source elevation resolution, tile refinement, imagery and appearance remain distinct; the real provider comparison is recorded in `market-and-provider-review.md`.

The built app now offers an explicit, bounded offline planning pack for the interface/fonts/public facts. Complete-body hashes, release matching, failed installation retention, cache-eviction readiness/repair and manual reconnection are checked. Local app-host outage/reload, mobile selection/saved-plan/note reading and recovery are rendered; full network-loss/device/browser QA remains open. No provider tiles, forecasts, runtime tokens or private notes are archived, and this does not introduce offline navigation.

The accessibility slice preserves the panel design while adding native modal background isolation, keyboard skip links, result/selection announcements, dynamic file-disclosure Tab order and safe focus restoration. Redundant map markers have equivalent panel/library actions rather than adding dozens of duplicate Tab stops. Personal notes also have explicit, blank WGS84 coordinate fields, normalized into the same bounded numeric local schema; this is a keyboard and renderer-independent input path, not geolocation tracking or incident verification. Local note resolution retains its history and moves focus to the updated dialog context.

## First vertical slice and verification

`summit selection → Cesium camera → summit details → approach comparison → route geometry and hut markers` is the core journey. Release verification also covers recovery, accessibility, backend behavior, persistence, production artifacts and the full traceability in the release plan.
