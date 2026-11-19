import { trailColor } from "./trail-display.js?v=vitosha-trails-20261119-3";

export function createMarkedTrailLayer(Cesium, scene) {
  let features, primitive, instances = [];
  let visible = true, opacity = 1, appliedOpacity = 1;

  function updateOpacity() {
    if (!primitive?.ready || opacity === appliedOpacity) return;
    for (const { id, color } of instances) {
      const attributes = primitive.getGeometryInstanceAttributes(id);
      attributes.color = Cesium.ColorGeometryInstanceAttribute.toValue(color.withAlpha(color.alpha * opacity), attributes.color);
    }
    appliedOpacity = opacity;
    scene.requestRender();
  }
  const removeListener = scene.postRender.addEventListener(updateOpacity);

  function instance(feature, positions, width, color) {
    const id = { markedTrail: feature };
    return {
      id, color,
      geometry: new Cesium.GeometryInstance({
        id,
        geometry: new Cesium.GroundPolylineGeometry({ positions, width }),
        attributes: { color: Cesium.ColorGeometryInstanceAttribute.fromColor(color.withAlpha(color.alpha * opacity)) },
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
        show: visible,
      }));
      scene.groundPrimitives.lowerToBottom(primitive);
      appliedOpacity = opacity;
      scene.requestRender();
    },
    setStyle(show, dimmed) {
      visible = show;
      opacity = dimmed ? 0.35 : 1;
      if (primitive) primitive.show = visible;
      updateOpacity();
      scene.requestRender();
    },
    pick(position) {
      return visible && primitive?.ready ? scene.pick(position)?.id?.markedTrail ?? null : null;
    },
    destroy() {
      removeListener();
      if (primitive) scene.groundPrimitives.remove(primitive);
    },
  };
}
