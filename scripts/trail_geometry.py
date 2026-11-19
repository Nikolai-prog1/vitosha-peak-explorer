"""Geometry helpers shared by OSM capture filtering and the trail builder."""

import heapq
import math
from collections import Counter, defaultdict

VITOSHA_BOUNDS = (23.05, 42.40, 23.60, 42.76)
CAPTURE_BOUNDS = (23.15, 42.45, 23.42, 42.68)
METRES_PER_DEGREE = math.tau * 6_371_000 / 360
LON_SCALE = METRES_PER_DEGREE * math.cos(math.radians(42.58))


def clip_segment(start, end, bounds):
    """Clip a straight segment to a lon/lat rectangle (Liang–Barsky)."""
    west, south, east, north = bounds
    lon, lat = start
    dx, dy = end[0] - lon, end[1] - lat
    low, high = 0.0, 1.0
    for direction, margin in ((-dx, lon - west), (dx, east - lon), (-dy, lat - south), (dy, north - lat)):
        if not direction:
            if margin < 0:
                return None
            continue
        fraction = margin / direction
        if direction < 0:
            low = max(low, fraction)
        else:
            high = min(high, fraction)
        if high <= low:
            return None

    def point(fraction):
        return (round(min(east, max(west, lon + fraction * dx)), 7),
                round(min(north, max(south, lat + fraction * dy)), 7))

    first, last = point(low), point(high)
    return (first, last) if first != last else None


def metres(point):
    return (point[0] - 23.30) * LON_SCALE, (point[1] - 42.58) * METRES_PER_DEGREE


def point_segment_distance_sq(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    length_sq = dx * dx + dy * dy
    fraction = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length_sq)) if length_sq else 0
    return (point[0] - start[0] - fraction * dx) ** 2 + (point[1] - start[1] - fraction * dy) ** 2


def simplify_line(line, tolerance):
    """Douglas–Peucker, with original endpoints retained."""
    projected = [metres(point) for point in line]
    retained = {0, len(line) - 1}
    pending = [(0, len(line) - 1)]
    while pending:
        start, end = pending.pop()
        if end - start < 2:
            continue
        furthest = max(range(start + 1, end),
                       key=lambda i: point_segment_distance_sq(projected[i], projected[start], projected[end]))
        if point_segment_distance_sq(projected[furthest], projected[start], projected[end]) > tolerance ** 2:
            retained.add(furthest)
            pending.extend(((start, furthest), (furthest, end)))
    if len(retained) == 2 and line[0] == line[-1]:
        retained.add(max(range(1, len(line) - 1), key=lambda i: math.dist(projected[i], projected[0])))
    return [line[index] for index in sorted(retained)]


def clipped_way(geometry):
    points = [None if not point else (round(point["lon"], 7), round(point["lat"], 7)) for point in geometry]
    west, south, east, north = VITOSHA_BOUNDS
    clipped = any(point and not (west <= point[0] <= east and south <= point[1] <= north) for point in points)
    lines = []
    current = []
    for start, end in zip(points, points[1:]):
        if start and start == end:
            continue
        segment = clip_segment(start, end, VITOSHA_BOUNDS) if start and end else None
        if segment and current and current[-1] == segment[0]:
            current.append(segment[1])
        else:
            if current:
                lines.append(current)
            current = list(segment) if segment else []
    if current:
        lines.append(current)
    return lines, clipped


def stitch_lines(lines):
    """Join paths with shared endpoints, retaining separate branches and gaps."""
    ends = defaultdict(list)
    for index, line in enumerate(lines):
        ends[line[0]].append(index)
        ends[line[-1]].append(index)
    used = set()

    def walk(index, at):
        line = list(lines[index] if lines[index][0] == at else reversed(lines[index]))
        used.add(index)
        while len(ends[line[-1]]) == 2:
            remaining = [other for other in ends[line[-1]] if other not in used]
            if not remaining:
                break
            other = remaining[0]
            continuation = lines[other] if lines[other][0] == line[-1] else lines[other][::-1]
            line.extend(continuation[1:])
            used.add(other)
        return line

    joined = []
    for at, indexes in ends.items():
        if len(indexes) != 2:
            joined.extend(walk(index, at) for index in indexes if index not in used)
    joined.extend(walk(index, line[0]) for index, line in enumerate(lines) if index not in used)
    return joined


def connected_pieces(lines):
    parents = list(range(len(lines)))

    def root(index):
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    owners = {}
    for index, line in enumerate(lines):
        for point in line:
            other = owners.setdefault(point, index)
            parents[root(index)] = root(other)
    return len({root(index) for index in range(len(lines))})


def sample_line(line, interval):
    """Sample a coordinate line by distance along it, retaining both endpoints."""
    samples = [tuple(line[0])]
    length, next_sample = 0, interval
    for start, end in zip(line, line[1:]):
        segment_length = math.dist(metres(start), metres(end))
        if not segment_length:
            continue
        while next_sample <= length + segment_length:
            fraction = (next_sample - length) / segment_length
            samples.append(tuple(a + (b - a) * fraction for a, b in zip(start, end)))
            next_sample += interval
        length += segment_length
    end = tuple(line[-1])
    if math.dist(metres(samples[-1]), metres(end)) > 0.000001:
        samples.append(end)
    return samples


class TrailProximity:
    def __init__(self, trails):
        self.cells = defaultdict(list)
        for trail_id, lines in trails.items():
            for line in lines:
                projected = [metres(point) for point in line]
                for start, end in zip(projected, projected[1:]):
                    west, south = self.cell((min(start[0], end[0]) - 20, min(start[1], end[1]) - 20))
                    east, north = self.cell((max(start[0], end[0]) + 20, max(start[1], end[1]) + 20))
                    for x in range(west, east + 1):
                        for y in range(south, north + 1):
                            self.cells[x, y].append((trail_id, start, end))

    @staticmethod
    def cell(point):
        return math.floor(point[0] / 80), math.floor(point[1] / 80)

    def shares(self, line):
        samples = sample_line(line, 10)
        counts = Counter()
        any_count = 0
        for coordinate in samples:
            point = metres(coordinate)
            matches = {trail_id for trail_id, start, end in self.cells.get(self.cell(point), ())
                       if point_segment_distance_sq(point, start, end) <= 20 ** 2}
            counts.update(matches)
            any_count += bool(matches)
        return ({trail_id: round(count / len(samples), 2) for trail_id, count in counts.items()},
                round(any_count / len(samples), 2))


def trail_graph(lines):
    graph = defaultdict(dict)
    for line in lines:
        for start, end in zip(line, line[1:]):
            length = math.dist(metres(start), metres(end))
            graph[start][end] = graph[end][start] = length
    return graph


def shortest_path(graph, start, end):
    if not graph:
        return None
    distances_to_start = {point: math.dist(metres(point), metres(start)) for point in graph}
    distances_to_end = {point: math.dist(metres(point), metres(end)) for point in graph}
    first = min(graph, key=lambda point: (distances_to_start[point], point))
    last = min(graph, key=lambda point: (distances_to_end[point], point))
    if distances_to_start[first] > 300 or distances_to_end[last] > 300 or first == last:
        return None
    distances = {first: 0}
    parents = {}
    queue = [(0, first)]
    while queue:
        distance, point = heapq.heappop(queue)
        if point == last:
            path = [last]
            while path[-1] != first:
                path.append(parents[path[-1]])
            return path[::-1]
        if distance > distances[point]:
            continue
        for other, length in graph[point].items():
            candidate = distance + length
            if candidate < distances.get(other, math.inf):
                distances[other] = candidate
                parents[other] = point
                heapq.heappush(queue, (candidate, other))
    return None
