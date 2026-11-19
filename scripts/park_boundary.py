"""Vitosha Nature Park rings and exact segment clipping in a local metric projection."""

import math
import re
from collections import defaultdict

from trail_geometry import metres, point_segment_distance_sq, stitch_lines

PARK_BUFFER_M = 300
_ROW_M = 500
_T_EPS = 1e-10
_POINT_EPS = 1e-5


def is_vitosha_park(tags):
    if tags.get("boundary") != "protected_area":
        return False
    names = {re.sub(r"[^\w ]", "", tags.get(key, "").casefold()).strip()
             for key in ("name", "name:bg", "name:en")}
    return bool(names & {"витоша", "vitosha", "природен парк витоша", "витоша природен парк",
                         "vitosha nature park", "vitosha natural park"})


def select_park_relation(elements):
    matches = [element for element in elements
               if element["type"] == "relation" and is_vitosha_park(element.get("tags", {}))]
    if len(matches) > 1:
        for field, value in (("protect_class", "5"), ("leisure", "nature_reserve")):
            preferred = [element for element in matches if element["tags"].get(field) == value]
            if preferred:
                matches = preferred
            if len(matches) == 1:
                break
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one OSM relation for Vitosha Nature Park, found {len(matches)}")
    return matches[0]


def park_rings(relation):
    rings = []
    for role in ("outer", "inner"):
        ways = []
        for member in relation.get("members", []):
            if member["type"] != "way" or (member.get("role") or "outer") != role:
                continue
            geometry = member.get("geometry")
            if not geometry or any(point is None for point in geometry):
                raise ValueError(f"OSM park boundary way {member['ref']} has incomplete geometry")
            line = [(round(point["lon"], 7), round(point["lat"], 7)) for point in geometry]
            if len(line) < 2:
                raise ValueError(f"OSM park boundary way {member['ref']} has fewer than two points")
            ways.append(line)
        joined = stitch_lines(ways)
        if role == "outer" and not joined:
            raise ValueError("The OSM park relation has no outer ring")
        for ring in joined:
            if ring[0] != ring[-1] or len(set(ring)) < 3:
                raise ValueError(f"The OSM park relation has an open or degenerate {role} ring")
        rings.extend(joined)
    return rings


def interpolate(start, end, fraction):
    if fraction == 0:
        return start
    if fraction == 1:
        return end
    return tuple(a + fraction * (b - a) for a, b in zip(start, end))


def _subtract(left, right):
    return left[0] - right[0], left[1] - right[1]


def _dot(left, right):
    return left[0] * right[0] + left[1] * right[1]


def _cross(left, right):
    return left[0] * right[1] - left[1] * right[0]


def _crossings(start, delta, a, b, delta_squared):
    direction = _subtract(b, a)
    offset = _subtract(a, start)
    divisor = _cross(delta, direction)
    if abs(divisor) > 1e-9:
        along = _cross(offset, direction) / divisor
        on_edge = _cross(offset, delta) / divisor
        if -_T_EPS <= along <= 1 + _T_EPS and -_T_EPS <= on_edge <= 1 + _T_EPS:
            return (min(1, max(0, along)),)
    elif abs(_cross(offset, delta)) <= _POINT_EPS * math.sqrt(delta_squared):
        return tuple(min(1, max(0, _dot(_subtract(point, start), delta) / delta_squared)) for point in (a, b))
    return ()


def _linear_interval(origin, slope, low, high):
    if abs(slope) <= 1e-12:
        return (0.0, 1.0) if low <= origin <= high else None
    left, right = sorted(((low - origin) / slope, (high - origin) / slope))
    return max(0, left), min(1, right)


def _edge_buffer_intervals(start, delta, a, b, radius, delta_squared):
    # The buffer of a finite edge is a rectangle with a disc at each end.
    direction = _subtract(b, a)
    offset = _subtract(start, a)
    squared = _dot(direction, direction)
    span = radius * math.sqrt(squared)
    along = _linear_interval(_dot(direction, offset), _dot(direction, delta), 0, squared)
    across = _linear_interval(_cross(direction, offset), _cross(direction, delta), -span, span)
    if along and across:
        yield max(along[0], across[0]), min(along[1], across[1])
    for center in (a, b):
        offset = _subtract(center, start)
        middle = _dot(offset, delta) / delta_squared
        perpendicular_squared = _cross(offset, delta) ** 2 / delta_squared
        if perpendicular_squared < radius ** 2:
            half = math.sqrt((radius ** 2 - perpendicular_squared) / delta_squared)
            yield max(0, middle - half), min(1, middle + half)


def _merge_intervals(parts):
    merged = []
    for left, right in sorted(parts):
        if right - left <= _T_EPS:
            continue
        if merged and left <= merged[-1][1] + _T_EPS:
            merged[-1] = merged[-1][0], max(right, merged[-1][1])
        else:
            merged.append((left, right))
    return merged


class ParkBoundary:
    def __init__(self, relation):
        self.relation_id = relation["id"]
        self.rings = park_rings(relation)
        self.edges = []
        self.rows = defaultdict(list)
        for ring in self.rings:
            projected = [metres(point) for point in ring]
            for start, end in zip(projected, projected[1:]):
                if start == end:
                    continue
                index = len(self.edges)
                west, east = sorted((start[0], end[0]))
                south, north = sorted((start[1], end[1]))
                self.edges.append((start, end, west, south, east, north))
                for row in range(math.floor(south / _ROW_M), math.floor(north / _ROW_M) + 1):
                    self.rows[row].append(index)
        self.west = min(edge[2] for edge in self.edges)
        self.south = min(edge[3] for edge in self.edges)
        self.east = max(edge[4] for edge in self.edges)
        self.north = max(edge[5] for edge in self.edges)

    def _nearby(self, west, south, east, north, radius):
        west, south, east, north = west - radius, south - radius, east + radius, north + radius
        if east < self.west or west > self.east or north < self.south or south > self.north:
            return
        first = math.floor(max(south, self.south) / _ROW_M)
        last = math.floor(min(north, self.north) / _ROW_M)
        indexes = {index for row in range(first, last + 1) for index in self.rows.get(row, ())}
        for index in indexes:
            a, b, left, bottom, right, top = self.edges[index]
            if right >= west and left <= east and top >= south and bottom <= north:
                yield a, b

    def _inside(self, point):
        x, y = point
        if x < self.west - _POINT_EPS or x > self.east + _POINT_EPS or y < self.south - _POINT_EPS or y > self.north + _POINT_EPS:
            return False
        for a, b in self._nearby(x, y, x, y, _POINT_EPS):
            if point_segment_distance_sq(point, a, b) <= _POINT_EPS ** 2:
                return True
        inside = False
        # Even–odd parity handles disjoint outer rings, inner rings and islands.
        for index in self.rows.get(math.floor(y / _ROW_M), ()):
            a, b, _, _, east, _ = self.edges[index]
            if east > x and ((a[1] > y) != (b[1] > y)):
                if x < a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]):
                    inside = not inside
        return inside

    def contains(self, point, radius=PARK_BUFFER_M):
        point = metres(point)
        x, y = point
        return self._inside(point) or (radius > 0 and any(
            point_segment_distance_sq(point, a, b) <= (radius + _POINT_EPS) ** 2
            for a, b in self._nearby(x, y, x, y, radius + _POINT_EPS)))

    def intervals(self, start, end, radius=PARK_BUFFER_M):
        """Return fraction intervals in the park and in the park with its buffer."""
        first, last = metres(start), metres(end)
        delta = _subtract(last, first)
        distance_squared = _dot(delta, delta)
        if not distance_squared:
            return ([(0, 1)] if self._inside(first) else [],
                    [(0, 1)] if self.contains(start, radius) else [])
        west, east = sorted((first[0], last[0]))
        south, north = sorted((first[1], last[1]))
        crossings = [0.0, 1.0]
        for a, b in self._nearby(west, south, east, north, _POINT_EPS):
            crossings.extend(_crossings(first, delta, a, b, distance_squared))
        stations = sorted(crossings)
        inside = _merge_intervals((left, right) for left, right in zip(stations, stations[1:])
                                  if right - left > _T_EPS and self._inside(interpolate(first, last, (left + right) / 2)))
        if not radius or inside == [(0, 1)]:
            return inside, inside
        halo = (part for a, b in self._nearby(west, south, east, north, radius)
                for part in _edge_buffer_intervals(first, delta, a, b, radius, distance_squared))
        return inside, _merge_intervals([*inside, *halo])

    def contains_segment(self, start, end):
        _, buffered = self.intervals(start, end)
        return (len(buffered) == 1 and buffered[0][0] <= _T_EPS and buffered[0][1] >= 1 - _T_EPS
                and self.contains(start) and self.contains(end))
