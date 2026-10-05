# Market and provider evidence — 2026-10-05

This is a focused planning comparison, not proof of market leadership. No user research, revenue, traffic or traction has been invented.

## Hiking-planning expectations

AllTrails exposes saved trails/lists, 3D previews, weather/conditions, sharing and offline maps. Its support documentation distinguishes online 3D imagery from offline trail information. Komoot's shop lists offline maps, 3D maps, route weather and personal collections.

Primary sources:

- [AllTrails features](https://www.alltrails.com/plus/info)
- [AllTrails 3D availability](https://support.alltrails.com/hc/en-us/articles/37213898696340-How-to-view-AllTrails-maps-in-3D)
- [AllTrails offline park details](https://support.alltrails.com/hc/en-us/articles/37212750759956-Downloading-parks-for-offline-use)
- [Komoot shop](https://www.komoot.com/shop)

For this product, the defensible proposed position is a fast, bilingual, transparent Vitosha-specific planning experience: mountain-only labels, hut approaches, summit forecast and useful locally saved information. Whether users prefer it requires actual usability and customer evidence. Competitors' navigation/community features are not automatically compatible with the application's stated informational and local-report boundaries.

## Commercial and data gates

Open-Meteo distinguishes its non-commercial free API from the commercial customer endpoint. A commercial key must stay on the production server, and forecasts require attribution. Cesium ion access and imagery usage depend on the account plan and content terms. Bing imagery must not be packaged into an offline tile archive. Cesium's summary and full Bing terms should be reviewed for the final intended use; this document is not a legal determination.

Primary sources:

- [Open-Meteo terms](https://open-meteo.com/en/terms)
- [Open-Meteo commercial endpoint and pricing](https://open-meteo.com/en/pricing)
- [Cesium ion plans](https://cesium.com/platform/cesium-ion/pricing/)
- [Cesium content usage and attribution](https://cesium.com/learn/ion/content-usage-and-attribution-guide/)
- [Full Bing content terms](https://cesium.com/legal/terms-for-bing/)

Release requirements: retain dynamic imagery/terrain attribution, add OSM attribution and data age, disclose device-local persistence and external service calls, and verify provider entitlements before commercial publication. Do not claim that the supplied client token proves a commercial licence.

## Vitosha relief assessment

The updated user objective permits either Cesium ion or Mapbox; practical visual quality matters more than retaining a particular renderer. Separate elevation source resolution/accuracy from imagery quality, tile refinement, surface shading, camera framing and device cost. Exaggerating heights cannot create new terrain detail.

Cesium describes approximate 30 m World Terrain source resolution for Europe, with varying regional sources. This is not a verified site-specific resolution or vertical-accuracy measurement at Cherni vrah. Quantized-mesh vertex normals allow terrain lighting. Mapbox Terrain-DEM encodes height in 0.1 m increments but that encoding step is not spatial resolution or a vertical-accuracy guarantee. Its tiles contain elevation data up to zoom 14; zooming beyond that does not introduce new source elevation detail. Mixed sources and vertical datums need care before interpreting small differences.

Primary sources:

- [Cesium World Terrain content and regional resolution](https://cesium.com/platform/cesium-ion/content/cesium-world-terrain/)
- [Cesium terrain lighting and screen-space error](https://cesium.com/learn/cesiumjs/ref-doc/Globe.html)
- [Cesium directional-light presentation](https://cesium.com/learn/cesiumjs/ref-doc/DirectionalLight.html)
- [Mapbox Terrain-DEM encoding, data zoom and source limitations](https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-dem-v1/)
- [Mapbox GL JS terrain setup](https://docs.mapbox.com/mapbox-gl-js/example/add-terrain/)
- [Mapbox hillshade style settings](https://docs.mapbox.com/style-spec/reference/layers/#hillshade)

### Implemented and observed locally

The active Cesium 1.146.0 map now requests World Terrain vertex normals, enables fixed stylized directional daylight, and uses a 1.25 screen-space-error target instead of the default 2. Geometry stays at true 1× height scale. The light is consistent visual styling, not a representation of the real current sun, shadow conditions or forecast. Smaller screen-space error allows finer available tile refinement; it does not increase source resolution.

A temporary Mapbox GL JS 3.32.0 prototype was installed outside the repository and rendered on an isolated loopback origin. It uses satellite-v9 without base labels, Terrain-DEM at 1×, the same 124-point public Aleko–Cherni approach and public hut/summit coordinates, and similar panel footprints. Optional 0.35 hillshade is shading strength, not terrain exaggeration. No personal plans or notes are accessed, no executable CDN or unsafe-eval is added, and this is not a shipped replacement. Both imagery/terrain providers actually loaded. Screenshots showed different imagery colours and surface shading; these are qualitative appearance observations only.

The comparison used similar heading/pitch and free panel area, but not identical projection, source dates, tile availability, screen-space resolution or height origins. It cannot establish that one provider is more accurate, sharper or faster. The first hillshade probe reused the terrain DEM source and the SDK warned of lower hillshade resolution. The final probe used an independent hillshade DEM source and rendered route/close views with no current warning or error logs; this removes that particular quality limitation at additional, unmeasured memory cost. Keep shading configuration separate from the raw elevation data.

Cesium remains the provisional application implementation because the integrated route/marker/camera workflows are verified there; this is not a claim that it is the objectively best Vitosha dataset. Before selecting a final provider, match camera/extent on multiple ridge and hut scenes, inspect actual local source provenance and measure frame time, memory, tile latency and recovery on representative desktop/mobile hardware. Preserve visible attribution and verify the intended commercial account/content rights independently.
