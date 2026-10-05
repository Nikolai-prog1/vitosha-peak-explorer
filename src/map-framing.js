const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// Pixel rectangles, not CSS breakpoints: the map can live in a narrow app panel.
export function availableMapViewport(width, height, occluders = [], gap = 12) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const bounds = { left: gap, top: gap, right: width - gap, bottom: height - gap };
  const obstacles = occluders.filter(rect => rect && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite))
    .filter(rect => rect.right > rect.left && rect.bottom > rect.top && overlaps(rect, bounds))
    .map(rect => ({ left: Math.max(bounds.left, rect.left - gap), top: Math.max(bounds.top, rect.top - gap), right: Math.min(bounds.right, rect.right + gap), bottom: Math.min(bounds.bottom, rect.bottom + gap) }));
  const xs = [...new Set([bounds.left, bounds.right, ...obstacles.flatMap(rect => [rect.left, rect.right])])].sort((a, b) => a - b);
  const ys = [...new Set([bounds.top, bounds.bottom, ...obstacles.flatMap(rect => [rect.top, rect.bottom])])].sort((a, b) => a - b);
  let best = null, bestArea = 0;
  for (let x = 0; x < xs.length - 1; x += 1) for (let right = x + 1; right < xs.length; right += 1) {
    if (xs[right] - xs[x] < 160) continue;
    for (let y = 0; y < ys.length - 1; y += 1) for (let bottom = y + 1; bottom < ys.length; bottom += 1) {
      const rect = { left: xs[x], right: xs[right], top: ys[y], bottom: ys[bottom] };
      const area = (rect.right - rect.left) * (rect.bottom - rect.top);
      if (rect.bottom - rect.top < 80 || area <= bestArea || obstacles.some(item => overlaps(rect, item))) continue;
      best = rect; bestArea = area;
    }
  }
  return best ? { ...best, width, height } : null;
}

const usablePoint = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
  && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
const altitude = (value, fallback = 1900) => Number.isFinite(value) ? value : fallback;

export function placeFramePoint(place) {
  const point = place?.geometry?.coordinates;
  return usablePoint(point) ? [point[0], point[1], altitude(place.properties?.elevation_m) + 14] : null;
}

// Include actual place markers as well as the line: endpoint gaps must not hide a hut.
export function routeFramePoints(entries, summit) {
  const peak = placeFramePoint(summit), points = [];
  for (const entry of entries) {
    const path = entry?.path;
    if (!Array.isArray(path) || path.length < 2) continue;
    const hut = placeFramePoint(entry.feature), profile = entry.routeFeature?.properties?.profile_elevations_m;
    const start = altitude(hut?.[2]), end = altitude(peak?.[2], start);
    path.forEach((point, index) => {
      if (!usablePoint(point)) return;
      const fallback = start + (end - start) * index / (path.length - 1);
      points.push([point[0], point[1], altitude(profile?.length === path.length ? profile[index] : point[2], fallback)]);
    });
    if (hut) points.push(hut);
  }
  if (points.length && peak) points.push(peak);
  return points;
}

export function cameraFramePose(Cesium, points, viewport, frustum, { heading = -24, pitch = -48, minimumRange = 2500 } = {}) {
  const coordinates = points.filter(usablePoint);
  if (!coordinates.length || !viewport) return null;
  const { Cartesian3: C, Matrix4: M, FixedFrameTransforms: T } = Cesium;
  const positions = coordinates.map(point => C.fromDegrees(point[0], point[1], altitude(point[2])));
  const sphere = Cesium.BoundingSphere.fromPoints(positions), center = sphere.center;
  const transform = T.eastNorthUpToFixedFrame(center);
  const h = heading * Math.PI / 180, p = pitch * Math.PI / 180;
  const direction = M.multiplyByPointAsVector(transform, new C(Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)), new C());
  const up = M.multiplyByPointAsVector(transform, new C(-Math.sin(h) * Math.sin(p), -Math.cos(h) * Math.sin(p), Math.cos(p)), new C());
  C.normalize(direction, direction); C.normalize(up, up);
  const right = C.normalize(C.cross(direction, up, new C()), new C());
  const { width, height, left, top, right: edge, bottom } = viewport;
  const paddingX = Math.min(78, (edge - left) * 0.23), paddingTop = Math.min(64, (bottom - top) * 0.24), paddingBottom = Math.min(42, (bottom - top) * 0.2);
  const fit = { left: left + paddingX, right: edge - paddingX, top: top + paddingTop, bottom: bottom - paddingBottom };
  const centerX = (fit.left + fit.right) / 2, centerY = (fit.top + fit.bottom) / 2;
  const cx = 2 * centerX / width - 1, cy = 1 - 2 * centerY / height;
  const minX = 2 * fit.left / width - 1, maxX = 2 * fit.right / width - 1;
  const minY = 1 - 2 * fit.bottom / height, maxY = 1 - 2 * fit.top / height;
  const tanY = Math.tan(frustum.fovy / 2), tanX = tanY * frustum.aspectRatio;
  if (![tanX, tanY].every(value => Number.isFinite(value) && value > 0)) return null;
  let range = minimumRange;
  for (const position of positions) {
    const delta = C.subtract(position, center, new C());
    const x = C.dot(delta, right), y = C.dot(delta, up), z = C.dot(delta, direction);
    range = Math.max(range, 1 - z,
      (minX * z * tanX - x) / ((cx - minX) * tanX), (x - maxX * z * tanX) / ((maxX - cx) * tanX),
      (minY * z * tanY - y) / ((cy - minY) * tanY), (y - maxY * z * tanY) / ((maxY - cy) * tanY));
  }
  range *= 1.06;
  const destination = C.add(center, C.multiplyByScalar(direction, -range, new C()), new C());
  C.add(destination, C.multiplyByScalar(right, -cx * range * tanX, new C()), destination);
  C.add(destination, C.multiplyByScalar(up, -cy * range * tanY, new C()), destination);
  // Translate the camera, not its frustum. Cesium's normal pick/zoom rays stay correct.
  return { destination, direction, up, range, center, fit, centerX, centerY };
}

export function createFrameScheduler({ readViewport, applyFrame, requestFrame, cancelFrame }) {
  let queued = null, current = null, automatic = false, explicit = false, destroyed = false, previousViewport = "";
  const schedule = () => {
    if (destroyed || !automatic || queued !== null) return;
    queued = requestFrame(() => {
      queued = null;
      if (destroyed || !automatic || !current) return;
      const viewport = readViewport();
      if (!viewport) return; // A chooser or other overlay can cover the whole map.
      const key = [viewport.width, viewport.height, viewport.left, viewport.top, viewport.right, viewport.bottom].join(",");
      if (!explicit && key === previousViewport) return;
      const duration = explicit ? current.duration : 0.4;
      explicit = false; previousViewport = key;
      applyFrame({ ...current, viewport, duration });
    });
  };
  return {
    request(points, options = {}, duration = 1.2) { if (destroyed) return; current = { points, options, duration }; automatic = true; explicit = true; schedule(); },
    layoutChanged: schedule,
    interrupt() { automatic = false; if (queued !== null) cancelFrame(queued); queued = null; },
    destroy() { destroyed = true; automatic = false; if (queued !== null) cancelFrame(queued); queued = null; current = null; },
  };
}
