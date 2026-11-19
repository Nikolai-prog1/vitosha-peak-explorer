import { placeName } from "./i18n.js?v=vitosha-trails-20261119";

export function buildHutIndex(huts, hutRoutes) {
  const index = new Map(huts.map(hut => [hut.properties.id, { hut, approaches: [] }]));
  for (const { properties: route } of hutRoutes) {
    index.get(route.hut_id)?.approaches.push({
      peakId: route.peak_id,
      routeId: route.id,
      distanceKm: route.distance_km,
      approximate: route.geometry_kind === "approximate",
    });
  }
  for (const { approaches } of index.values()) {
    approaches.sort((left, right) => left.distanceKm - right.distanceKm || left.routeId.localeCompare(right.routeId, "en"));
  }
  return index;
}

export function hutsSorted(huts, mode, language) {
  const elevation = hut => hut.properties.elevation_m ?? -Infinity;
  return [...huts].sort((left, right) => {
    const byHeight = mode === "name" ? 0 : elevation(right) - elevation(left);
    return byHeight || placeName(left, language).localeCompare(placeName(right, language), language)
      || left.properties.id.localeCompare(right.properties.id, "en");
  });
}

export function hutKindKey(hut) {
  return hut.properties.kind === "shelter" ? "hutKindShelter" : "hutKindHut";
}
