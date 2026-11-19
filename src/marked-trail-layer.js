import { trailColor } from "./trail-display.js?v=vitosha-trails-20261119-4";

export function createMarkedTrailLayer(Cesium, scene) {
  let features, primitive, instances = [];
  let visibleIds = new Set(), opacity = 1;
  let appliedIds, appliedOpacity;
  const isVisible = feature => visibleIds === null || visibleIds.has(feature.properties.id);

  function applyStyle() {
    if (!primitive?.ready || (visibleIds === appliedIds && opacity === appliedOpacity)) return;
    for (const { id, color } of instances) {
      const attributes = primitive.getGeometryInstanceAttributes(id);
      const show = isVisible(id.markedTrail);
      if (Boolean(attributes.show[0]) !== show) {
        attributes.show = Cesium.ShowGeometryInstanceAttribute.toValue(show, attributes.show);
      }
      if (opacity !== appliedOpacity) {
        attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(color.withAlpha(color.alpha * opacity), attributes.color);
      }
    }
    primitive.show = visibleIds === null || visibleIds.size > 0;
    appliedIds = visibleIds;
    appliedOpacity = opacity;
    scene.requestRender();
  }
  const removeListener = scene.postRender.addEventListener(applyStyle);

  function instance(feature, positions, width, color) {
    const id = { markedTrail: feature };
    return {
      id, color,
      geometry: new Cesium.GeometryInstance({
        id,
        geometry: new Cesium.GroundPolylineGeometry({ positions, width }),
        attributes: {
          color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
          show: new Cesium.ShowGeometryInstanceAttribute(false),
        },
      }),
    };
  }

  return {
    setFeatures(value) {
      if (features === value) return;
      features = value;
      if (primitive) scene.groundPrimitives.remove(primitive);
      primitive = null;
      instances = [];
      if (!features.length) return;
      const outlines = [], markings = [];
      const outline = Cesium.Color.fromCssColorString("#10151f").withAlpha(0.76);
      for (const feature of features) {
        const color = Cesium.Color.fromCssColorString(trailColor(feature.properties.colour));
        for (const line of feature.geometry.coordinates) {
          const positions = Cesium.Cartesian3.fromDegreesArray(line.flat());
          outlines.push(instance(feature, positions, 5, outline));
          markings.push(instance(feature, positions, 3, color));
        }
      }
      // One ground batch. Render halos first so any adjacent marking stays above them.
      instances = [...outlines, ...markings];
      primitive = scene.groundPrimitives.add(new Cesium.GroundPolylinePrimitive({
        geometryInstances: instances.map(item => item.geometry),
        appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
        classificationType: Cesium.ClassificationType.TERRAIN,
      }));
      scene.groundPrimitives.lowerToBottom(primitive);
      // Prepare the batch with every instance hidden. A focus change during
      // worker preparation cannot display stale trails for a frame.
      appliedIds = appliedOpacity = undefined;
      applyStyle();
      scene.requestRender();
    },
    setStyle(ids, dimmed) {
      visibleIds = ids;
      opacity = dimmed ? 0.35 : 1;
      applyStyle();
      scene.requestRender();
    },
    pick(position) {
      if (!primitive?.ready || !primitive.show) return null;
      const picked = scene.pick(position)?.id?.markedTrail;
      return picked && isVisible(picked) ? picked : null;
    },
    destroy() {
      removeListener();
      if (primitive) scene.groundPrimitives.remove(primitive);
    },
  };
}
