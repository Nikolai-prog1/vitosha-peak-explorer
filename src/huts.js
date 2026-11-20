import { placeName } from "./i18n.js?v=vitosha-huts-20261120-2";

// A summit's own approaches: its three nearest distinct open trailheads.
export const PEAK_APPROACH = "nearest-routable-huts";
// The nearest summit of an open hut that no summit lists; shown from the hut card.
export const HUT_APPROACH = "hut-nearest-summit";

// A summit lists its own approaches; a hut-only approach joins last, only while its hut is the chosen one.
export function summitApproaches(hutRoutes, peakId, selectedHutId) {
  const routes = hutRoutes.filter(route => route.properties.peak_id === peakId);
  return [...routes.filter(route => route.properties.ranking_mode === PEAK_APPROACH),
    ...routes.filter(route => route.properties.ranking_mode !== PEAK_APPROACH && route.properties.hut_id === selectedHutId)];
}

export function hutClosed(hut) {
  return hut.properties.details?.status?.value === "closed";
}

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
  return { shelter: "hutKindShelter", lodge: "hutKindLodge" }[hut.properties.kind] ?? "hutKindHut";
}
